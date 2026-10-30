// DOM environment is selected by the dom Vitest project.
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContactWorkspace } from '../../src/crm/ContactWorkspace'
import { ContactRepository } from '../../src/crm/contacts'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import type { ContactProfile } from '../../src/crm/contact-model'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => '/admin/crm',
}))
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api', admin: '/admin' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
vi.mock('../../src/crm/ConstituentSummary', () => ({ ConstituentSummary: (): null => null }))
vi.mock('../../src/crm/ContactRelationships', () => ({
  ContactRelationships: () => <p>Selected constituent relationships</p>,
}))
vi.mock('../../src/crm/ContactGifts', () => ({
  ContactGifts: () => <p>Selected constituent gifts</p>,
}))
vi.mock('../../src/crm/ContactCorrections', () => ({ ContactCorrections: (): null => null }))
vi.mock('../../src/crm/ContactActivities', () => ({ ContactActivities: (): null => null }))
vi.mock('../../src/crm/AttachmentWorkspace', () => ({ AttachmentWorkspace: (): null => null }))
vi.mock('../../src/crm/CorrespondenceWorkspace', () => ({
  CorrespondenceWorkspace: ({ initialGift }: { initialGift?: string }) => (
    <p>Receipt source: {initialGift}</p>
  ),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('cancels and saves inline profile edits through the existing shared update action', async () => {
  const fixture = await crmTimelineFixture()
  try {
    window.history.replaceState(null, '',
      `/?view=contacts&site=default&contact=${fixture.contact}&contactTab=information`)
    const contacts = new ContactRepository(fixture.db, 1)
    let current = await contacts.get('default', fixture.contact)
    let writes = 0
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const parsed = new URL(url, window.location.href)
      if (parsed.pathname.endsWith('/context'))
        return Response.json({ site: { id: 'default', name: 'Local chapter' }, canCreate: true })
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { action: string; profile: ContactProfile; confirmedSharedUpdate: boolean }
        expect(body.action).toBe('update-profile')
        expect(body.confirmedSharedUpdate).toBe(true)
        current = { ...current, profile: body.profile }
        writes++
        return Response.json({ doc: { id: fixture.contact } })
      }
      if (parsed.searchParams.get('view') === 'corrections')
        return Response.json({ docs: [], total: 0, next: null, canResolve: false })
      if (parsed.searchParams.get('id'))
        return Response.json({ doc: { ...current, canEditProfile: true, canEditChapter: true } })
      return Response.json(await contacts.list({ site: 'default' }))
    })
    render(<ContactWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit identity' }))
    expect(screen.getByRole('dialog', { name: 'Edit identity' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Preferred name'), { target: { value: 'Discard me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByDisplayValue('Discard me')).toBeNull())
    expect(writes).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Add contact method' }))
    expect(screen.getByRole('dialog', { name: 'Contact methods' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit identity' }))
    expect(screen.getByRole('dialog', { name: 'Edit identity' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Preferred name'), { target: { value: 'Pat' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirm this update to the shared contact profile/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(writes).toBe(1))
    await waitFor(() => expect(screen.getByText('Pat')).toBeTruthy())
  } finally {
    fixture.close()
  }
})

it('restores the authorized constituent tab, retains changes across remount, and clears selection on close', async () => {
  const fixture = await crmTimelineFixture()
  try {
    window.history.replaceState(
      null,
      '',
      `/?view=contacts&site=default&contact=${fixture.contact}&contactTab=relationships`,
    )
    const contacts = new ContactRepository(fixture.db, 1)
    vi.stubGlobal('fetch', async (url: string) => {
      const parsed = new URL(url, window.location.href)
      expect(parsed.searchParams.get('site')).toBe('default')
      if (parsed.pathname.endsWith('/context'))
        return Response.json({ site: { id: 'default', name: 'Local chapter' }, canCreate: true })
      const id = parsed.searchParams.get('id')
      if (id) {
        const doc = await contacts.get('default', id)
        return Response.json({ doc: { ...doc, profile: { ...doc.profile, methods: [
          { kind: 'phone', value: '555-0100', label: 'Other', primary: false },
          { kind: 'phone', value: '555-0101', label: 'Primary', primary: true },
          { kind: 'email', value: 'first@example.invalid', label: 'Other', primary: false },
          { kind: 'email', value: 'primary@example.invalid', label: 'Primary', primary: true },
        ] } } })
      }
      return Response.json(await contacts.list({ site: 'default' }))
    })
    let mounted = render(<ContactWorkspace />)
    await screen.findByText('Selected constituent relationships')
    expect(screen.getByRole('heading', { name: 'Fictional timeline donor' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '555-0101' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'primary@example.invalid' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Activity', 'Information', 'Comments', 'Tasks', 'Gifts', 'Pledges and recurring',
      'Memberships', 'Opportunities', 'Volunteers', 'Receipts and Correspondence',
    ])
    expect(screen.getByRole('tab', { name: 'Information' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Relationships' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Shared profile' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Chapter details' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Chapter' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter details' })).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'Relationships' })).toBeNull()
    expect(new URLSearchParams(window.location.search).get('infoSection')).toBe('chapter')
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Shared profile' })).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'Chapter details' })).toBeNull()
    expect(screen.queryByRole('button', { name: '← Contacts' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Gifts' }))
    expect(new URLSearchParams(window.location.search).get('contactTab')).toBe('gifts')
    mounted.unmount()
    mounted = render(<ContactWorkspace />)
    await screen.findByText('Selected constituent gifts')
    expect(screen.getByRole('tab', { name: 'Gifts' }).getAttribute('aria-selected')).toBe('true')
    window.history.replaceState(
      null,
      '',
      `/?view=contacts&site=default&contact=${fixture.contact}&contactTab=correspondence&receiptGift=selected-gift`,
    )
    mounted.rerender(<ContactWorkspace />)
    await screen.findByText('Receipt source: selected-gift')
    mounted.unmount()
  } finally {
    fixture.close()
  }
})
