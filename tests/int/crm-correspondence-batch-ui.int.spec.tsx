// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { correspondenceBatchSchemaV1 } from '../../src/crm/correspondence-batch-schema-v1'
import { CorrespondenceRepository } from '../../src/crm/correspondence'
import { ContactRepository } from '../../src/crm/contacts'
import { CRMJobs } from '../../src/crm/jobs'
import { correspondenceBatchEndpoints } from '../../src/crm/correspondence-batch-endpoints'
import { correspondenceEndpoints } from '../../src/crm/correspondence-endpoints'
import { CorrespondenceBatchWorkspace } from '../../src/crm/CorrespondenceBatchWorkspace'
import { errorResponse } from '../../src/crm/plugin'
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api', admin: '/admin' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('selects recipients, retains reviews, previews, approves, produces real private PDFs and reloads without duplicate issuance', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = await crmTimelineFixture(),
    key = () => crypto.randomUUID()
  try {
    for (const sql of correspondenceBatchSchemaV1) fixture.sqlite.exec(sql)
    await new ContactRepository(fixture.db, 1).create({
      site: 'default',
      operationKey: key(),
      profile: { kind: 'person', firstName: 'Fictional second UI recipient' },
      roles: ['contact'],
    })
    await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
      site: 'default',
      operationKey: key(),
      values: {
        name: 'Fictional UI batch template',
        kind: 'general',
        subject: 'Hello {{recipient.name}}',
        body: 'Fictional message for {{recipient.name}}.',
      },
    })
    const unrelated = String(
      (
        await new CRMJobs(fixture.db).enqueue({
          actor: 1,
          site: 'default',
          kind: 'correspondence',
          operationKey: key(),
          payload: { document: 'fictional-unrelated-private-job' },
        })
      ).id,
    )
    const objects = new Map<string, { bytes: Uint8Array; metadata: Record<string, string> }>()
    const storage = {
      async put(
        id: string,
        bytes: Uint8Array,
        options: { customMetadata: Record<string, string> },
      ) {
        objects.set(id, { bytes, metadata: options.customMetadata })
        return { key: id }
      },
      async delete(id: string) {
        objects.delete(id)
      },
      async get(id: string) {
        const row = objects.get(id)
        return row
          ? {
              body: new Response(row.bytes).body,
              size: row.bytes.length,
              customMetadata: row.metadata,
            }
          : null
      },
    } as unknown as R2Bucket
    const routes = [
      ...correspondenceBatchEndpoints(fixture.db, errorResponse, storage),
      ...correspondenceEndpoints(fixture.db, errorResponse, storage),
    ]
    vi.stubGlobal('fetch', async (raw: string, init?: RequestInit) => {
      const url = new URL(raw, 'https://crm.test'),
        method = init?.method === 'POST' ? 'post' : 'get',
        endpoint = routes.find((row) => '/api' + row.path === url.pathname && row.method === method)
      if (!endpoint) throw new Error('Unexpected fixture request: ' + url.pathname)
      const incoming = new Request(url, {
        ...init,
        headers: { ...init?.headers, origin: 'https://crm.test' },
      })
      return endpoint.handler({
        url: url.href,
        headers: incoming.headers,
        body: incoming.body,
        user: { id: 1, collection: 'users' },
      } as PayloadRequest)
    })
    const props = { api: '/api', site: 'default' }
    let mounted = render(<CorrespondenceBatchWorkspace {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create correspondence batch' }))
    const editor = screen.getByRole('region', { name: 'Correspondence batch editor' })
    fireEvent.change(within(editor).getByLabelText('Batch name'), {
      target: { value: 'Fictional retained UI batch' },
    })
    const template = await within(editor).findByRole('option', {
      name: 'Fictional UI batch template (general)',
    })
    fireEvent.change(within(editor).getByLabelText('Batch template'), {
      target: { value: (template as HTMLOptionElement).value },
    })
    fireEvent.change(within(editor).getByLabelText('Batch issuer name'), {
      target: { value: 'Fictional UI charity' },
    })
    fireEvent.change(within(editor).getByLabelText('Batch issuer address'), {
      target: { value: 'Fictional UI office' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save batch configuration' }))
    await screen.findByRole('region', { name: 'Batch recipient selection' })
    fireEvent.click(await screen.findByRole('button', { name: 'Select this recipient page' }))
    expect(
      screen
        .getByRole('button', { name: 'Approve batch and issue documents' })
        .hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare selected reviews' }))
    await screen.findByText(
      '2 prepared recipients; 0 issued. 0 reviews have configuration or access changes.',
    )
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Approve batch and issue documents' })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(0)
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview correspondence for Fictional timeline donor' }),
    )
    const preview = await screen.findByRole('region', { name: 'Batch recipient preview' })
    expect(
      within(preview).getByText('Fictional message for Fictional timeline donor.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close batch recipient preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve batch and issue documents' }))
    await screen.findByText(
      '2 prepared recipients; 2 issued. 0 reviews have configuration or access changes.',
      {},
      { timeout: 20000 },
    )
    await waitFor(() => expect(objects.size).toBe(2), { timeout: 20000 })
    await waitFor(
      () =>
        expect(
          screen
            .getByRole('button', { name: 'Close correspondence batch' })
            .hasAttribute('disabled'),
        ).toBe(false),
      { timeout: 20000 },
    )
    expect(
      fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(unrelated)!.status,
    ).toBe('pending')
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_email_outbox').get()!.n).toBe(0)
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview correspondence for Fictional timeline donor' }),
    )
    const pdf = await screen.findByRole('link', { name: 'Download private PDF' })
    const response = await fetch(pdf.getAttribute('href')!)
    expect(response.status).toBe(200)
    expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5))).toBe('%PDF-')
    mounted.unmount()
    mounted = render(<CorrespondenceBatchWorkspace {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Fictional retained UI batch' }))
    await screen.findByText(
      '2 prepared recipients; 2 issued. 0 reviews have configuration or access changes.',
    )
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(2)
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(fixture.contact)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh correspondence batches' }))
    await screen.findByRole('button', { name: 'Reload accessible batches' })
    expect(screen.queryByRole('region', { name: 'Correspondence batch details' })).toBeNull()
    expect(screen.queryByText('Fictional retained UI batch')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reload accessible batches' }))
    await screen.findByText('No accessible correspondence batches.')
    expect(screen.queryByText(/processing steps completed in this view/)).toBeNull()
    expect(screen.queryByText('Loading authorized batch…')).toBeNull()
  } finally {
    fixture.close()
  }
}, 60000)
