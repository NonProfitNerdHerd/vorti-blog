// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PayloadRequest } from 'payload'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { correspondenceSchemaV1 } from '../../src/crm/correspondence-schema-v1'
import { correspondenceEndpoints } from '../../src/crm/correspondence-endpoints'
import { CorrespondenceTemplates } from '../../src/crm/CorrespondenceTemplates'
import { CorrespondenceHistory } from '../../src/crm/CorrespondenceHistory'
import { CorrespondenceCompose } from '../../src/crm/CorrespondenceCompose'
import { ContactRepository } from '../../src/crm/contacts'
import { CorrespondenceDocuments } from '../../src/crm/correspondence-documents'
import { crmJobSchemaV1 } from '../../src/crm/job-schema-v1'
import { emailSchemaV1 } from '../../src/crm/email-schema-v1'
import { emailDeliveryEndpoints } from '../../src/crm/email-delivery-endpoints'
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('creates, previews and reloads retained template versions through authenticated endpoints', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = localD1()
  try {
    fixture.sqlite.exec(
      "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT);INSERT INTO users VALUES(1,'administrator');",
    )
    for (const sql of [
      ...organizationSchema,
      ...defaultOrganizationSeed,
      ...contactSchemaV1,
      ...crmJobSchemaV1,
      ...correspondenceSchemaV1,
      ...emailSchemaV1,
    ])
      fixture.sqlite.exec(sql)
    const failure = (error: unknown) =>
      Response.json(
        { message: (error as Error).message },
        { status: Number((error as { status?: number }).status) || 400 },
      )
    const endpoints = [
      ...correspondenceEndpoints(fixture.db, failure),
      ...emailDeliveryEndpoints(fixture.db, failure),
    ]
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const endpoint = endpoints.find(
        (endpoint) =>
          endpoint.method === (init?.method || 'GET').toLowerCase() &&
          '/api' + endpoint.path === new URL(url, 'https://crm.test').pathname,
      )!
      const incoming = new Request(new URL(url, 'https://crm.test'), {
        ...init,
        headers: { ...init?.headers, origin: 'https://crm.test' },
      })
      return endpoint.handler({
        url: new URL(url, 'https://crm.test').href,
        headers: incoming.headers,
        body: incoming.body,
        user: { id: 1, collection: 'users' },
        json: async () => JSON.parse(String(init?.body)),
      } as unknown as PayloadRequest)
    })
    const mounted = render(<CorrespondenceTemplates api="/api" site="default" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create correspondence template' }))
    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'Fictional thanks' },
    })
    fireEvent.change(screen.getByLabelText('Template subject'), {
      target: { value: 'Thank you {{recipient.name}}' },
    })
    fireEvent.change(screen.getByLabelText('Template body'), {
      target: { value: 'Dear {{recipient.name}},\nThank you <script>sample</script>' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview template' }))
    expect(screen.getByRole('region', { name: 'Template preview' }).textContent).toContain(
      'Thank you <script>sample</script>',
    )
    expect(document.querySelector('script')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save template version' }))
    await screen.findByRole('button', { name: 'Open Fictional thanks' })
    mounted.unmount()
    render(<CorrespondenceTemplates api="/api" site="default" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Fictional thanks' }))
    expect((screen.getByLabelText('Template body') as HTMLTextAreaElement).value).toContain(
      'Dear {{recipient.name}}',
    )
    fireEvent.change(screen.getByLabelText('Template body'), {
      target: { value: 'Revised thanks {{recipient.name}}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save template version' }))
    await waitFor(() =>
      expect(
        fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_template_versions').get(),
      ).toEqual({ n: 2 }),
    )
    await screen.findByRole('button', { name: 'Open Fictional thanks' })
    const contact = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: 'default',
          profile: { kind: 'person', firstName: 'History recipient' },
          roles: ['contact'],
          operationKey: crypto.randomUUID(),
        })
      ).id,
    )
    const template = String(
      (fixture.sqlite.prepare('SELECT id FROM vc_crm_templates').get() as { id: string }).id,
    )
    const documents = new CorrespondenceDocuments(fixture.db, 1)
    const request = {
      site: 'default',
      contact,
      template,
      issuedOn: '2026-10-24',
      issuerName: 'Fictional nonprofit',
      issuerAddress: '',
    }
    const preview = await documents.preview(request)
    expect(preview.snapshot.body).toContain('Revised thanks History recipient')
    cleanup()
    render(<CorrespondenceCompose api="/api" site="default" contact={contact} />)
    await screen.findByRole('option', { name: /Fictional thanks/ })
    fireEvent.change(screen.getByLabelText('Document template'), { target: { value: template } })
    fireEvent.change(screen.getByLabelText('Issuer name'), {
      target: { value: 'Fictional nonprofit' },
    })
    fireEvent.change(screen.getByLabelText('Document date'), { target: { value: '2026-10-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview resolved document' }))
    expect(
      (await screen.findByRole('region', { name: 'Resolved document preview' })).textContent,
    ).toContain('Revised thanks History recipient')
    fireEvent.click(screen.getByRole('button', { name: 'Issue reviewed document' }))
    await screen.findByRole('link', { name: 'Open issued printable HTML' })
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel PDF generation' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry PDF generation' }))
    await screen.findByRole('button', { name: 'Cancel PDF generation' })
    const issued = fixture.sqlite.prepare('SELECT id FROM vc_crm_documents').get() as { id: string }
    cleanup()
    const history = render(<CorrespondenceHistory api="/api" site="default" contact={contact} />)
    fireEvent.click(await screen.findByRole('button', { name: `Open document ${issued.id}` }))
    expect(await screen.findByRole('link', { name: 'Open printable HTML' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Issued document' }).textContent).toContain(
      'Revised thanks History recipient',
    )
    history.rerender(<CorrespondenceHistory api="/api" site="unavailable" contact={contact} />)
    expect(screen.queryByText('Revised thanks History recipient')).toBeNull()
    await screen.findByRole('alert')
  } finally {
    cleanup()
    fixture.close()
  }
})
