import { afterEach, beforeEach, expect, it } from 'vitest'
import { utils, write } from 'xlsx'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { importStorage } from '../helpers/crm-import-storage'
import { ImportFiles } from '../../src/crm/import-files'
import { startImportStaging } from '../../src/crm/import-staging'
import { importJob } from '../../src/crm/import-job'
import { CRMJobs } from '../../src/crm/jobs'
import { OrganizationRepository } from '../../src/organizations/repository'
let fixture: Awaited<ReturnType<typeof crmImportFixture>>,
  files: ImportFiles,
  bucket: ReturnType<typeof importStorage>
const key = () => crypto.randomUUID(),
  body = (bytes: Uint8Array) => new Response(bytes).body!
const digest = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
beforeEach(async () => {
  fixture = await crmImportFixture()
  bucket = importStorage()
  files = new ImportFiles(fixture.db, bucket.storage, 1)
})
afterEach(() => fixture.close())
async function upload(bytes: Uint8Array, filename = 'fictional.csv') {
  const input = {
    site: 'default',
    name: 'Fictional source import',
    domain: 'contacts',
    sourceSystem: 'Fictional old CRM',
    filename,
    size: bytes.length,
    sha256: await digest(bytes),
    operationKey: key(),
  }
  const created = await files.create(input)
  expect(await files.create(input)).toEqual(created)
  const id = String(created.id),
    operationKey = key()
  const uploaded = await files.upload({
    site: 'default',
    id,
    expectedRevision: 1,
    operationKey,
    body: body(bytes),
  })
  expect(
    await files.upload({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey,
      body: body(bytes),
    }),
  ).toEqual(uploaded)
  return id
}
async function stage(id: string, options = { headerRow: 1, sheet: '', delimiter: ',' as const }) {
  const inspected = await files.inspect('default', id, options)
  await files.configure({
    site: 'default',
    id,
    expectedRevision: 2,
    options: inspected.options,
    signature: inspected.signature,
    operationKey: key(),
  })
  return startImportStaging(fixture.db, 1, {
    site: 'default',
    id,
    expectedRevision: 3,
    operationKey: key(),
  })
}
async function finish(job: string) {
  const jobs = new CRMJobs(fixture.db),
    handler = importJob(fixture.db, bucket.storage)
  for (let index = 0; index < 100; index++)
    if (!(await jobs.tick({ 'import-apply': handler }, job))) break
  expect(fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(job)!.status).toBe(
    'completed',
  )
}
it('uploads privately, inspects exact headers and resumes every staged CSV row after cancellation without domain writes', async () => {
  const data =
    '\uFEFF"ID",Name,Notes,Blank\r\n' +
    Array.from(
      { length: 57 },
      (_, index) =>
        `"${String(index).padStart(6, '0')}","Fictional Zoë 😀 ${index}","${index === 19 ? 'Two\r\nlines ""quoted""' : 'Note'}",`,
    ).join('\r\n') +
    '\r\n'
  const bytes = new TextEncoder().encode(data),
    id = await upload(bytes),
    queued = await stage(id),
    job = String(queued.job),
    jobs = new CRMJobs(fixture.db)
  await jobs.tick({ 'import-apply': importJob(fixture.db, bucket.storage) }, job)
  expect(
    fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_rows WHERE run_id=?').get(id)!
      .n,
  ).toBe(25)
  const current = fixture.sqlite
    .prepare('SELECT fence,cursor FROM vc_crm_jobs WHERE id=?')
    .get(job)!
  expect(JSON.parse(String(current.cursor)).resume.offset).toBeGreaterThan(0)
  await jobs.cancel(1, 'default', job, key(), Number(current.fence))
  const cancelled = fixture.sqlite.prepare('SELECT fence FROM vc_crm_jobs WHERE id=?').get(job)!
  await jobs.retry(1, 'default', job, Number(cancelled.fence), key())
  await finish(job)
  const rows = fixture.sqlite
    .prepare('SELECT number,data_json FROM vc_crm_import_rows WHERE run_id=? ORDER BY number')
    .all(id)
  expect(rows).toHaveLength(57)
  expect(rows[0].number).toBe(2)
  expect(rows.at(-1)!.number).toBe(58)
  expect(JSON.parse(String(rows[19].data_json))).toEqual([
    '000019',
    'Fictional Zoë 😀 19',
    'Two\r\nlines "quoted"',
    '',
  ])
  expect(
    fixture.sqlite.prepare('SELECT stage_state FROM vc_crm_import_runs WHERE id=?').get(id)!
      .stage_state,
  ).toBe('review')
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
  expect(
    fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_source_identifiers').get()!.n,
  ).toBe(0)
  const downloaded = await files.download('default', id)
  expect(downloaded.headers.get('Cache-Control')).toBe('private, no-store')
  expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes)
})
it('keeps checksum-verified storage on a lost reply and permits an idempotent upload retry', async () => {
  const bytes = new TextEncoder().encode('ID,Name\n001,Fictional\n'),
    created = await files.create({
      site: 'default',
      name: 'Fictional interrupted upload',
      domain: 'contacts',
      sourceSystem: 'Old',
      filename: 'fictional.csv',
      size: bytes.length,
      sha256: await digest(bytes),
      operationKey: key(),
    }),
    id = String(created.id),
    operationKey = key()
  bucket.loseNextReply()
  await expect(
    files.upload({ site: 'default', id, expectedRevision: 1, operationKey, body: body(bytes) }),
  ).rejects.toThrow('lost R2 reply')
  expect(
    fixture.sqlite.prepare('SELECT file_uploaded_at FROM vc_crm_import_runs WHERE id=?').get(id)!
      .file_uploaded_at,
  ).toBeNull()
  await expect(files.download('default', id)).rejects.toThrow('upload')
  await files.upload({ site: 'default', id, expectedRevision: 1, operationKey, body: body(bytes) })
  expect(bucket.objects.size).toBe(1)
  expect((await files.inspect('default', id)).headers).toEqual(['ID', 'Name'])
})
it('rejects bad bytes, stale source edits, cross-site access and another uploader before exposing source data', async () => {
  const bytes = new TextEncoder().encode('ID,Name\n001,Fictional\n'),
    created = await files.create({
      site: 'default',
      name: 'Fictional private upload',
      domain: 'contacts',
      sourceSystem: 'Old',
      filename: 'fictional.csv',
      size: bytes.length,
      sha256: await digest(bytes),
      operationKey: key(),
    }),
    id = String(created.id)
  await expect(
    files.upload({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey: key(),
      body: body(new Uint8Array(bytes.length)),
    }),
  ).rejects.toThrow('checksum')
  await expect(
    files.upload({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey: key(),
      body: body(new Uint8Array(bytes.length + 1)),
    }),
  ).rejects.toThrow('size')
  await files.upload({
    site: 'default',
    id,
    expectedRevision: 1,
    operationKey: key(),
    body: body(bytes),
  })
  const inspected = await files.inspect('default', id)
  await expect(
    files.configure({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey: key(),
      options: inspected.options,
      signature: inspected.signature,
    }),
  ).rejects.toThrow('changed')
  await expect(files.download('other', id)).rejects.toThrow()
  const revision = Number(
    fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
  )
  await new OrganizationRepository(fixture.db, 1).setMembership({
    site: 'default',
    user: 2,
    role: 'editor',
    active: true,
    expectedRevision: revision,
    operationKey: key(),
  })
  await expect(
    new ImportFiles(fixture.db, bucket.storage, 2).download('default', id),
  ).rejects.toThrow()
  expect(
    fixture.sqlite.prepare('SELECT stage_state FROM vc_crm_import_runs WHERE id=?').get(id)!
      .stage_state,
  ).toBe('ready')
})
it('stages the selected XLSX sheet/header with sparse row numbers and explicit trailing blanks', async () => {
  const book = utils.book_new()
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([['Wrong'], ['Fictional ignored sheet']]),
    'Other',
  )
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['Fictional metadata'],
      ['ID', 'Name', 'Blank'],
      ['0001', 'Fictional one'],
      [],
      ['0002', 'Fictional two'],
    ]),
    'Contacts',
  )
  const bytes = new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' })),
    id = await upload(bytes, 'fictional.xlsx')
  const queued = await stage(id, { headerRow: 2, sheet: 'Contacts', delimiter: ',' })
  await finish(String(queued.job))
  const rows = fixture.sqlite
    .prepare('SELECT number,data_json FROM vc_crm_import_rows WHERE run_id=? ORDER BY number')
    .all(id)
  expect(rows.map((row) => row.number)).toEqual([3, 5])
  expect(JSON.parse(String(rows[0].data_json))).toEqual(['0001', 'Fictional one', ''])
  expect(JSON.parse(String(rows[1].data_json))).toEqual(['0002', 'Fictional two', ''])
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
})
it('marks malformed late input as failed instead of approving or silently dropping the invalid record', async () => {
  const valid = new TextEncoder().encode(
      'ID,Name\n' +
        Array.from({ length: 30 }, (_, index) => `${index},Fictional ${index}`).join('\n') +
        '\n',
    ),
    bytes = new Uint8Array(valid.length + 2)
  bytes.set(valid)
  bytes.set([255, 10], valid.length)
  const id = await upload(bytes),
    queued = await stage(id)
  await finish(String(queued.job))
  const run = fixture.sqlite
    .prepare('SELECT stage_state,stage_error,status FROM vc_crm_import_runs WHERE id=?')
    .get(id)!
  expect(run.stage_state).toBe('failed')
  expect(run.stage_error).toContain('UTF-8')
  expect(run.status).toBe('draft')
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
  expect(
    fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_source_identifiers').get()!.n,
  ).toBe(0)
})
