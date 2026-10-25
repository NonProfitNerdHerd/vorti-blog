// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { ActivityRepository } from '../../src/crm/activities'
import { FinanceRepository } from '../../src/crm/finance'
import { OrganizationRepository } from '../../src/organizations/repository'
import { timelineEndpoints } from '../../src/crm/timeline-endpoints'
import { ContactTimeline } from '../../src/crm/ContactTimeline'
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
it('paginates the real authorized timeline, opens source areas and clears revoked categories/records', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = await crmTimelineFixture(),
    key = () => crypto.randomUUID()
  try {
    for (let index = 0; index < 55; index++)
      await new ActivityRepository(fixture.db, 1).save({
        site: 'default',
        contact: fixture.contact,
        operationKey: key(),
        values: {
          kind: 'note',
          subject: `Fictional timeline note ${index}`,
          body: 'Fictional note body',
          occurredOn: '2026-10-24',
        },
      })
    const finance = new FinanceRepository(fixture.db, 1),
      fund = String(
        (
          await finance.createFund({
            site: 'default',
            name: 'Fictional timeline fund',
            operationKey: key(),
          })
        ).id,
      )
    await finance.createGift({
      site: 'default',
      constituent: fixture.contact,
      kind: 'cash',
      receivedOn: '2026-10-24',
      amount: { currency: 'USD', minorUnits: '1000' },
      exponent: 2,
      allocations: [{ fund, currency: 'USD', minorUnits: '1000' }],
      reference: 'Fictional private financial reference',
      operationKey: key(),
    })
    const authority = new OrganizationRepository(fixture.db, 1),
      revision = () =>
        Number(
          fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!
            .revision,
        )
    await authority.setMembership({
      site: 'default',
      user: 2,
      role: 'reader',
      active: true,
      expectedRevision: revision(),
      operationKey: key(),
    })
    const endpoint = timelineEndpoints(fixture.db, errorResponse)[0]
    vi.stubGlobal('fetch', async (raw: string) =>
      endpoint.handler({
        url: new URL(raw, 'https://crm.test').href,
        user: { id: 2, collection: 'users' },
      } as PayloadRequest),
    )
    const onOpen = vi.fn(),
      onDenied = vi.fn()
    render(
      <ContactTimeline
        api="/api"
        site="default"
        contact={fixture.contact}
        onOpen={onOpen}
        onDenied={onDenied}
      />,
    )
    await screen.findByText('58 authorized events. Showing 50 on this page.')
    fireEvent.click(screen.getByRole('button', { name: 'Older events' }))
    await screen.findByText('58 authorized events. Showing 8 on this page.')
    fireEvent.change(screen.getByRole('combobox', { name: 'Timeline area' }), {
      target: { value: 'giving' },
    })
    await screen.findByText('Recorded gift amount: USD 10.00')
    fireEvent.click(screen.getByRole('button', { name: 'View gifts, pledges and recurring' }))
    expect(onOpen).toHaveBeenLastCalledWith('gifts')
    await authority.setRestrictions({
      site: 'default',
      user: 2,
      denied: [{ category: 'finances', operation: 'read' }],
      expectedRevision: revision(),
      operationKey: key(),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))
    await screen.findByText('57 authorized events. Showing 50 on this page.')
    expect(screen.queryByText('Fictional private financial reference')).toBeNull()
    expect(screen.queryByRole('option', { name: 'Gifts, pledges and recurring' })).toBeNull()
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(fixture.contact)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))
    await screen.findByRole('alert')
    await waitFor(() => expect(onDenied).toHaveBeenCalled())
    expect(screen.queryByText(/authorized events\. Showing/)).toBeNull()
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  } finally {
    fixture.close()
  }
})
