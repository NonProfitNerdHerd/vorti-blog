// DOM environment is selected by the dom Vitest project.
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PayloadRequest } from 'payload'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { crmJobSchemaV1 } from '../../src/crm/job-schema-v1'
import { correspondenceSchemaV1 } from '../../src/crm/correspondence-schema-v1'
import { emailSchemaV1 } from '../../src/crm/email-schema-v1'
import { ContactRepository } from '../../src/crm/contacts'
import { CorrespondenceRepository } from '../../src/crm/correspondence'
import { CorrespondenceDocuments } from '../../src/crm/correspondence-documents'
import { EmailConfiguration } from '../../src/crm/email-configuration'
import { emailDeliveryEndpoints } from '../../src/crm/email-delivery-endpoints'
import { EmailDelivery } from '../../src/crm/EmailDelivery'
import type { EmailRuntime } from '../../src/crm/email-provider'
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('reviews and queues one message, cancels/retries it unchanged, and clears private content after revocation', async () => {
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
    const runtime: EmailRuntime = {
      environment: 'production',
      local: false,
      liveSendingEnabled: true,
      apiKey: 're_fictional_ui_only_key',
    }
    const config = new EmailConfiguration(
      fixture.db,
      1,
      runtime,
      vi.fn<typeof fetch>(async () =>
        Response.json({
          name: 'example.org',
          status: 'verified',
          capabilities: { sending: 'enabled' },
        }),
      ),
    )
    const settings = {
      provider: 'resend',
      senderEmail: 'receipts@example.org',
      senderName: 'Fictional nonprofit',
      replyTo: '',
      domainID: crypto.randomUUID(),
      enabled: false,
    }
    await config.save({
      site: 'default',
      expectedRevision: 0,
      operationKey: crypto.randomUUID(),
      values: settings,
    })
    await config.verify({ site: 'default', expectedRevision: 1, operationKey: crypto.randomUUID() })
    await config.save({
      site: 'default',
      expectedRevision: 2,
      operationKey: crypto.randomUUID(),
      values: { ...settings, enabled: true },
    })
    const contact = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: 'default',
          profile: {
            kind: 'person',
            firstName: 'Fictional recipient',
            methods: [{ kind: 'email', value: 'fictional@example.net' }],
          },
          roles: ['contact'],
          operationKey: crypto.randomUUID(),
        })
      ).id,
    )
    const template = String(
      (
        await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
          site: 'default',
          operationKey: crypto.randomUUID(),
          values: {
            name: 'General',
            kind: 'general',
            subject: 'Thanks',
            body: 'Dear {{recipient.name}}',
          },
        })
      ).id,
    )
    const documents = new CorrespondenceDocuments(fixture.db, 1),
      request = {
        site: 'default',
        contact,
        template,
        issuedOn: '2026-10-24',
        issuerName: 'Fictional nonprofit',
        issuerAddress: '',
      }
    const preview = await documents.preview(request),
      document = String(
        (
          await documents.issue({
            ...request,
            approval: preview.approval,
            operationKey: crypto.randomUUID(),
          })
        ).id,
      )
    let actor = 1
    const endpoints = emailDeliveryEndpoints(
      fixture.db,
      (error) =>
        Response.json(
          { message: 'Delivery unavailable.' },
          { status: Number((error as { status?: number }).status) || 400 },
        ),
      runtime,
    )
    const transport = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'https://crm.test')
      if (url.origin !== 'https://crm.test') throw Error('Unexpected external delivery request')
      const incoming = new Request(url, {
        ...init,
        headers: { ...init?.headers, origin: url.origin },
      })
      return endpoints
        .find((endpoint) => endpoint.method === (init?.method || 'GET').toLowerCase())!
        .handler({
          url: url.href,
          headers: incoming.headers,
          body: incoming.body,
          user: { id: actor, collection: 'users' },
        } as PayloadRequest)
    })
    vi.stubGlobal('fetch', transport)
    render(<EmailDelivery api="/api" site="default" document={document} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Preview email delivery' }))
    expect(
      (await screen.findByRole('region', { name: 'Reviewed email preview' })).textContent,
    ).toContain('Dear Fictional recipient')
    fireEvent.click(screen.getByRole('button', { name: 'Queue reviewed email' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel email delivery' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry unchanged email' }))
    await screen.findByRole('button', { name: 'Cancel email delivery' })
    expect(fixture.sqlite.prepare('SELECT status,attempts FROM vc_crm_email_outbox').get()).toEqual(
      { status: 'pending', attempts: 0 },
    )
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_email_outbox').get()).toEqual({
      n: 1,
    })
    actor = 999
    fireEvent.click(screen.getByRole('button', { name: 'Refresh email delivery' }))
    await screen.findByRole('alert')
    await waitFor(() =>
      expect(screen.queryByText('fictional@example.net', { exact: false })).toBeNull(),
    )
    expect(
      transport.mock.calls.every(([url]) => String(url).startsWith('/api/crm/email-deliveries')),
    ).toBe(true)
  } finally {
    cleanup()
    fixture.close()
  }
})
