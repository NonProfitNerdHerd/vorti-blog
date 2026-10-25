import { afterEach, beforeEach, expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { importStorage } from '../helpers/crm-import-storage'
import { importEndpoints } from '../../src/crm/import-endpoints'
import { errorResponse } from '../../src/crm/plugin'
import { CRMJobs } from '../../src/crm/jobs'
import { importJob } from '../../src/crm/import-job'
import type { ImportInspection } from '../../src/crm/import-files'
import type { ImportRuns } from '../../src/crm/import-runs'
type MutationResponse = {
  doc: { id: string; revision: number; job?: string }
  backgroundWakePending?: boolean
}
type RunResponse = Awaited<ReturnType<ImportRuns['get']>>
type RowsResponse = Awaited<ReturnType<ImportRuns['rows']>>
let fixture: Awaited<ReturnType<typeof crmImportFixture>>
beforeEach(async () => {
  fixture = await crmImportFixture()
})
afterEach(() => fixture.close())
const key = () => crypto.randomUUID()

it('connects private upload, staging, mapping, reviews and explicit one-time application without early donor writes', async () => {
  let wakeLost = true
  const bucket = importStorage(),
    wakes: string[] = [],
    endpoints = importEndpoints(
      {
        db: fixture.db,
        storage: bucket.storage,
        wake: async (job) => {
          wakes.push(job)
          if (wakeLost) {
            wakeLost = false
            throw new Error('Fictional uncertain dispatch acknowledgement')
          }
        },
      },
      errorResponse,
    )
  const request = async (
    method: string,
    query: string,
    body?: unknown,
    actor: number | null = 1,
  ) => {
    const url = new URL('/api/crm/imports' + query, 'https://crm.test'),
      incoming = new Request(url, {
        method,
        headers: { 'Content-Type': 'application/json', origin: url.origin },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    return endpoints
      .find((endpoint) => endpoint.method === method.toLowerCase())!
      .handler({
        url: incoming.url,
        headers: incoming.headers,
        body: incoming.body,
        user: actor ? { id: actor, collection: 'users' } : null,
      } as PayloadRequest)
  }
  const success = async <T = MutationResponse>(response: Response): Promise<T> => {
    const data = (await response.json()) as T
    expect(response.ok, JSON.stringify(data)).toBe(true)
    return data
  }
  const source = 'Source,Given name\r\nA,Fictional Ada\r\nB,Fictional Bea\r\n',
    bytes = new TextEncoder().encode(source)
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const created = await success(
    await request('POST', '', {
      site: 'default',
      action: 'create',
      actor: 2,
      name: 'Fictional migration',
      domain: 'contacts',
      sourceSystem: 'Fictional old CRM',
      filename: 'fictional.csv',
      size: bytes.length,
      sha256,
      operationKey: key(),
    }),
  )
  const id = String(created.doc.id)
  expect(
    fixture.sqlite.prepare('SELECT actor_id FROM vc_crm_import_runs WHERE id=?').get(id)!.actor_id,
  ).toBe(1)
  expect((await request('GET', `?site=default&id=${id}`, undefined, 2)).status).toBe(403)
  const uploadURL = new URL('/api/crm/imports/source', 'https://crm.test')
  uploadURL.search = new URLSearchParams({
    site: 'default',
    id,
    expectedRevision: '1',
    operationKey: key(),
  }).toString()
  const upload = () =>
    endpoints
      .find((endpoint) => endpoint.method === 'put')!
      .handler({
        url: uploadURL.href,
        headers: new Headers({ origin: uploadURL.origin }),
        body: new Response(bytes).body,
        user: { id: 1, collection: 'users' },
      } as PayloadRequest)
  bucket.loseNextReply()
  expect((await upload()).ok).toBe(false)
  const uploaded = await success(await upload())
  const inspected = await success<ImportInspection>(
    await request('GET', `?site=default&id=${id}&view=inspect`),
  )
  const configured = await success(
    await request('POST', '', {
      site: 'default',
      id,
      action: 'configure',
      expectedRevision: uploaded.doc.revision,
      options: inspected.options,
      signature: inspected.signature,
      operationKey: key(),
    }),
  )
  const staged = await success(
    await request('POST', '', {
      site: 'default',
      id,
      action: 'stage',
      expectedRevision: configured.doc.revision,
      operationKey: key(),
    }),
  )
  const runner = new CRMJobs(fixture.db),
    handlers = { 'import-apply': importJob(fixture.db, bucket.storage) }
  expect(staged.backgroundWakePending).toBe(true)
  for (let step = 0; step < 10; step++) if (!(await runner.tick(handlers, staged.doc.job))) break
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
  let state = await success<RunResponse>(await request('GET', `?site=default&id=${id}`))
  expect(state.doc.stage_state).toBe('review')
  const mapped = await success(
    await request('POST', '', {
      site: 'default',
      id,
      action: 'mapping',
      expectedRevision: state.doc.revision,
      mapping: {
        version: 1,
        domain: 'contacts',
        headers: inspected.headers,
        columns: [
          { field: 'sourceID', column: 0, clearBlank: false, referenceMode: 'record' },
          { field: 'firstName', column: 1, clearBlank: false, referenceMode: 'record' },
        ],
      },
      operationKey: key(),
    }),
  )
  const rows = await success<RowsResponse>(await request('GET', `?site=default&id=${id}&view=rows`))
  expect(rows.total).toBe(2)
  for (const row of rows.docs)
    await success(
      await request('POST', '', {
        site: 'default',
        id,
        action: 'review',
        expectedRevision: mapped.doc.revision,
        number: row.number,
        rowRevision: row.revision,
        decision: 'create',
        operationKey: key(),
      }),
    )
  state = await success<RunResponse>(await request('GET', `?site=default&id=${id}`))
  expect(state.totals.reviewed).toBe(2)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
  const approval = {
    site: 'default',
    id,
    action: 'approve',
    expectedRevision: state.doc.revision,
    allowNewUnidentified: false,
    operationKey: key(),
  }
  const approved = await success(await request('POST', '', approval))
  expect(
    (
      await request('POST', '', {
        site: 'default',
        id,
        action: 'cancel',
        expectedRevision: state.doc.revision,
        expectedFence: 0,
        operationKey: key(),
      })
    ).status,
  ).toBe(409)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
  for (let step = 0; step < 20; step++) if (!(await runner.tick(handlers, approved.doc.job))) break
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(3)
  expect((await success(await request('POST', '', approval))).doc.job).toBe(approved.doc.job)
  expect(await runner.tick(handlers, approved.doc.job)).toBe(false)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(3)
  expect(
    (await success<RunResponse>(await request('GET', `?site=default&id=${id}`))).totals.applied,
  ).toBe(2)
  expect(wakes).toEqual([staged.doc.job, approved.doc.job, approved.doc.job])
})
