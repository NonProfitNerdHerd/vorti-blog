// DOM environment is selected by the dom Vitest project.
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ContactWorkspace } from '../../src/crm/ContactWorkspace'
import { ContactRepository } from '../../src/crm/contacts'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'

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

it('restores the authorized constituent tab, retains changes across remount, and clears selection on close', async () => {
  const fixture = await crmTimelineFixture()
  try {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      },
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute('open')
      },
    })
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
      return Response.json(
        id ? { doc: await contacts.get('default', id) } : await contacts.list({ site: 'default' }),
      )
    })
    let mounted = render(<ContactWorkspace />)
    await screen.findByText('Selected constituent relationships')
    expect(
      (await screen.findByRole('tab', { name: 'Relationships' })).getAttribute('aria-selected'),
    ).toBe('true')
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
    fireEvent.click(screen.getByRole('button', { name: 'Close contact' }))
    expect(new URLSearchParams(window.location.search).has('contact')).toBe(false)
    expect(new URLSearchParams(window.location.search).has('contactTab')).toBe(false)
    expect(new URLSearchParams(window.location.search).has('receiptGift')).toBe(false)
    mounted.unmount()
  } finally {
    fixture.close()
  }
})
