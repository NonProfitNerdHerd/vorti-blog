// DOM environment is selected by the dom Vitest project.
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { HouseholdRepository } from '../../src/crm/households'
import { OrganizationRepository } from '../../src/organizations/repository'
import { attachmentEndpoints } from '../../src/crm/attachment-endpoints'
import { RecordAttachmentLink } from '../../src/crm/RecordAttachmentLink'
import { CRMWorkspace } from '../../src/crm/CRMWorkspace'
import { errorResponse } from '../../src/crm/plugin'

let query = '',
  selectedSite = 'default'
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api', admin: '/staff' } } }),
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query), usePathname:()=>'/admin/crm' }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: selectedSite } } }),
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  selectedSite = 'default'
})

it('pins attachment URLs to the record chapter, rejects invalid/mismatched contexts before any read', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(
    <RecordAttachmentLink site="chapter & one" link={{ type: 'pledge', id: 'record / one' }} />,
  )
  const link = screen.getByRole('link')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toContain('noopener')
  const address = new URL(link.getAttribute('href')!, 'https://crm.test')
  expect(address.pathname).toBe('/staff/crm')
  expect(address.searchParams.get('site')).toBe('chapter & one')
  expect(address.searchParams.get('recordID')).toBe('record / one')
  cleanup()
  for (const context of [
    'view=attachments&recordType=household&recordID=house',
    'view=attachments&site=other&recordType=household&recordID=house',
    'view=attachments&site=default&recordType=__proto__&recordID=house',
  ]) {
    query = context
    render(<CRMWorkspace />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
    cleanup()
  }
})

it('loads authorized parent labels through real endpoints and removes the record panel after revocation', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = await crmTimelineFixture(),
    key = () => crypto.randomUUID()
  try {
    const household = String(
      (
        await new HouseholdRepository(fixture.db, 1).mutate({
          site: 'default',
          action: 'create-household',
          operationKey: key(),
          values: { name: 'Fictional private household', address: 'Fictional address' },
        })
      ).id,
    )
    const authority = new OrganizationRepository(fixture.db, 1)
    const revision = () =>
      Number(
        fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
      )
    await authority.setMembership({
      site: 'default',
      user: 2,
      role: 'editor',
      active: true,
      expectedRevision: revision(),
      operationKey: key(),
    })
    const endpoint = attachmentEndpoints(fixture.db, {} as R2Bucket, errorResponse)[0]
    vi.stubGlobal('fetch', async (raw: string) =>
      endpoint.handler({
        url: new URL(raw, 'https://crm.test').href,
        user: { id: 2, collection: 'users' },
      } as PayloadRequest),
    )
    query = new URLSearchParams({
      view: 'attachments',
      site: 'default',
      recordType: 'household',
      recordID: household,
    }).toString()
    render(<CRMWorkspace />)
    await screen.findByText('Related record: Fictional private household')
    await screen.findByRole('button', { name: 'Upload private attachment' })
    await authority.setRestrictions({
      site: 'default',
      user: 2,
      denied: [{ category: 'affiliations', operation: 'read' }],
      expectedRevision: revision(),
      operationKey: key(),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh attachments' }))
    await screen.findByRole('alert')
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Private CRM attachments' })).toBeNull(),
    )
    expect(screen.queryByText('Related record: Fictional private household')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upload private attachment' })).toBeNull()
  } finally {
    fixture.close()
  }
})
