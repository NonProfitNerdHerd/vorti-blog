// DOM environment is selected by the dom Vitest project.
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { householdSchemaV1 } from '../../src/crm/household-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { membershipSchemaV1 } from '../../src/crm/membership-schema-v1'
import { opportunitySchemaV1 } from '../../src/crm/opportunity-schema-v1'
import { volunteerSchemaV1 } from '../../src/crm/volunteer-schema-v1'
import { attachmentSchemaV1 } from '../../src/crm/attachment-schema-v1'
import { ContactRepository } from '../../src/crm/contacts'
import { attachmentEndpoints } from '../../src/crm/attachment-endpoints'
import { AttachmentWorkspace } from '../../src/crm/AttachmentWorkspace'
import { errorResponse } from '../../src/crm/plugin'
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
it('uploads, reloads, archives and restores a private file and clears the panel after revocation', async () => {
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
      ...financeSchemaV1,
      ...fundraisingSchemaV1,
      ...householdSchemaV1,
      ...commitmentSchemaV1,
      ...membershipSchemaV1,
      ...opportunitySchemaV1,
      ...volunteerSchemaV1,
      ...attachmentSchemaV1,
    ])
      fixture.sqlite.exec(sql)
    const contact = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: 'default',
          profile: { kind: 'person', firstName: 'Fictional file recipient' },
          roles: ['donor'],
          operationKey: crypto.randomUUID(),
        })
      ).id,
    )
    const store = new Map<string, { size: number; checksums: { sha256: ArrayBuffer } }>()
    const storage = {
      put: vi.fn(async (key: string, bytes: Uint8Array) => {
        if (store.has(key)) return null
        const value = {
          size: bytes.length,
          checksums: { sha256: await webcrypto.subtle.digest('SHA-256', bytes) },
        }
        store.set(key, value)
        return value
      }),
      head: vi.fn(async (key: string) => store.get(key) || null),
    } as unknown as R2Bucket
    const endpoints = attachmentEndpoints(fixture.db, storage, errorResponse)
    let loseStageReply = true
    vi.stubGlobal('fetch', async (raw: string, init?: RequestInit) => {
      const url = new URL(raw, 'https://crm.test'),
        method = (init?.method || 'GET').toLowerCase()
      const endpoint = endpoints.find(
        (e) => e.path == url.pathname.replace('/api', '') && e.method === method,
      )!
      const incoming = new Request(url, {
        ...init,
        headers: { ...init?.headers, origin: 'https://crm.test' },
      })
      const response = await endpoint.handler({
        url: url.href,
        headers: incoming.headers,
        body: incoming.body,
        user: { id: 1, collection: 'users' },
        json: () => incoming.json(),
      } as unknown as PayloadRequest)
      if (method === 'post' && String(init?.body).includes('"action":"stage"') && loseStageReply) {
        loseStageReply = false
        throw new Error('Lost stage acknowledgement; retry the unchanged selection.')
      }
      return response
    })
    const props = { api: '/api', site: 'default', link: { type: 'contact' as const, id: contact } },
      dirty = vi.fn()
    let mounted = render(<AttachmentWorkspace {...props} onDirty={dirty} />)
    const file = new File(['Fictional private file'], 'Fictional.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('Fictional private file').buffer,
    })
    await screen.findByRole('button', { name: 'Upload private attachment' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Attachment information category' }), {
      target: { value: 'communications' },
    })
    fireEvent.change(screen.getByLabelText('Attachment file'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload private attachment' }))
    await screen.findByText('Lost stage acknowledgement; retry the unchanged selection.')
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_attachments').get()!.n).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Upload private attachment' }))
    await screen.findByRole('link', { name: 'Download Fictional.txt' })
    expect(storage.put).toHaveBeenCalledTimes(1)
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_attachments').get()!.n).toBe(1)
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false))
    mounted.unmount()
    mounted = render(<AttachmentWorkspace {...props} />)
    await screen.findByRole('link', { name: 'Download Fictional.txt' })
    fireEvent.click(screen.getByRole('button', { name: 'Archive Fictional.txt' }))
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Download Fictional.txt' })).toBeNull(),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Archived attachments' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Fictional.txt' }))
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Download Fictional.txt' })).toBeNull(),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Archived attachments' }))
    await screen.findByRole('link', { name: 'Download Fictional.txt' })
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(contact)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh attachments' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('link', { name: 'Download Fictional.txt' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upload private attachment' })).toBeNull()
  } finally {
    fixture.close()
  }
})
