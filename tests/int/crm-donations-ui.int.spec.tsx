// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PayloadRequest } from 'payload'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { DonationWorkspace } from '../../src/crm/DonationWorkspace'
import { FinanceRepository } from '../../src/crm/finance'
import { financeEndpoints } from '../../src/crm/finance-endpoints'
import { fundraisingEndpoints } from '../../src/crm/fundraising-endpoints'
import { ContactRepository } from '../../src/crm/contacts'
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/crm' }))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
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
it('records a chapter gift with an explicit donor and retains the gift and constituent link on remount', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = await crmTimelineFixture()
  try {
    const finance = new FinanceRepository(fixture.db, 1),
      fund = String(
        (
          await finance.createFund({
            site: 'default',
            name: 'Fictional global gift fund',
            operationKey: crypto.randomUUID(),
          })
        ).id,
      )
    const failure = (error: unknown) =>
      Response.json(
        { message: (error as Error).message },
        { status: Number((error as { status?: number }).status) || 400 },
      )
    const endpoints = [
      ...financeEndpoints(fixture.db, failure),
      ...fundraisingEndpoints(fixture.db, failure),
    ]
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const parsed = new URL(url, 'https://crm.test')
      if (parsed.pathname === '/api/crm/contacts')
        return Response.json(
          await new ContactRepository(fixture.db, 1).list({
            site: 'default',
            search: parsed.searchParams.get('search') || '',
          }),
        )
      const endpoint = endpoints.find(
        (endpoint) =>
          '/api' + endpoint.path === parsed.pathname &&
          endpoint.method === (init?.method || 'GET').toLowerCase(),
      )
      if (!endpoint) throw new Error(`Unexpected fixture endpoint ${parsed.pathname}`)
      const incoming = new Request(parsed, {
        ...init,
        headers: { ...init?.headers, origin: 'https://crm.test' },
      })
      return endpoint.handler({
        url: parsed.href,
        headers: incoming.headers,
        body: incoming.body,
        user: { id: 1, collection: 'users' },
        json: async () => JSON.parse(String(init?.body)),
      } as unknown as PayloadRequest)
    })
    const mounted = render(<DonationWorkspace api="/api" site="default" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Record gift' }))
    await screen.findByRole('option', { name: 'Fictional timeline donor' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Donor' }), {
      target: { value: fixture.contact },
    })
    fireEvent.change(screen.getByLabelText('Amount', { exact: true }), {
      target: { value: '23.45' },
    })
    fireEvent.change(screen.getByLabelText('Received on', { exact: true }), {
      target: { value: '2026-10-25' },
    })
    await screen.findByRole('option', { name: 'Fictional global gift fund' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Fund' }), {
      target: { value: fund },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save gift' }))
    await waitFor(() =>
      expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()!.n).toBe(1),
    )
    const donor = await screen.findByRole('link', { name: 'Fictional timeline donor' })
    expect(donor.getAttribute('href')).toBe(
      `/admin/crm?site=default&view=contacts&contact=${fixture.contact}`,
    )
    mounted.unmount()
    render(<DonationWorkspace api="/api" site="default" />)
    await screen.findByRole('link', { name: 'Fictional timeline donor' })
    expect(screen.getAllByText('USD 23.45')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '2026-10-25' }))
    const receipt = await screen.findByRole('link', { name: 'Prepare receipt or thank-you' })
    const receiptURL = new URL(receipt.getAttribute('href')!, 'https://crm.test')
    expect(receiptURL.searchParams.get('site')).toBe('default')
    expect(receiptURL.searchParams.get('contact')).toBe(fixture.contact)
    expect(receiptURL.searchParams.get('contactTab')).toBe('correspondence')
    expect(receiptURL.searchParams.get('receiptGift')).toBe(
      (fixture.sqlite.prepare('SELECT id FROM vc_crm_gifts').get() as { id: string }).id,
    )
  } finally {
    fixture.close()
  }
})
