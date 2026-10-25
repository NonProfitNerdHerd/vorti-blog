// @vitest-environment jsdom
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
import { emailSettingsEndpoints } from '../../src/crm/email-endpoints'
import { EmailSettings } from '../../src/crm/EmailSettings'
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
it('saves/reloads chapter sender settings while visibly disabling unconfigured live delivery', async () => {
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
    const endpoints = emailSettingsEndpoints(fixture.db, (error) =>
      Response.json(
        { message: 'Unavailable configuration.' },
        { status: Number((error as { status?: number }).status) || 400 },
      ),
    )
    const transport = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'https://crm.test')
      if (url.origin !== 'https://crm.test') throw Error('Unexpected external network request')
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
          user: { id: 1, collection: 'users' },
        } as PayloadRequest)
    })
    vi.stubGlobal('fetch', transport)
    const mounted = render(<EmailSettings api="/api" site="default" />)
    await screen.findByLabelText('Sender email')
    expect(
      screen.getByText(
        'Email delivery is unconfigured or disabled. Preview, print and PDF remain available.',
      ),
    ).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Email provider'), { target: { value: 'resend' } })
    fireEvent.change(screen.getByLabelText('Sender email'), {
      target: { value: 'receipts@example.org' },
    })
    fireEvent.change(screen.getByLabelText('Sender name'), {
      target: { value: 'Fictional nonprofit' },
    })
    fireEvent.change(screen.getByLabelText('Provider domain ID'), {
      target: { value: '00000000-0000-4000-8000-000000000001' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }))
    await waitFor(() =>
      expect(
        fixture.sqlite.prepare('SELECT sender_email FROM vc_crm_email_settings').get(),
      ).toEqual({ sender_email: 'receipts@example.org' }),
    )
    mounted.unmount()
    const reloaded = render(<EmailSettings api="/api" site="default" />)
    expect(
      ((await screen.findByLabelText('Sender email')) as unknown as HTMLInputElement).value,
    ).toBe('receipts@example.org')
    expect(
      screen.getByRole('button', { name: 'Verify sender domain' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByText('An installation operator must configure provider credentials.', {
        exact: false,
      }),
    ).toBeTruthy()
    reloaded.rerender(<EmailSettings api="/api" site="unavailable" />)
    expect(screen.queryByLabelText('Sender email')).toBeNull()
    await screen.findByRole('alert')
    expect(
      transport.mock.calls.every(([url]) => String(url).startsWith('/api/crm/email-settings')),
    ).toBe(true)
  } finally {
    cleanup()
    fixture.close()
  }
})
