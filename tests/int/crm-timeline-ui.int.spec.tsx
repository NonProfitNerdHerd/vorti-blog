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
import { CRMAttachments } from '../../src/crm/attachments'
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api', admin: '/staff' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('opens a related-record file in a separate pinned chapter tab and clears its filename after revocation', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = await crmTimelineFixture(),
    key = () => crypto.randomUUID()
  try {
    fixture.sqlite.exec(
      "INSERT INTO vc_crm_households(id,site_id,name,created_at,updated_at) VALUES('history-house','default','Fictional household','2026-10-24','2026-10-24')",
    )
    fixture.sqlite
      .prepare(
        "INSERT INTO vc_crm_household_members(id,household_id,constituent_id,started_on) VALUES('history-member','history-house',?,'2026-01-01')",
      )
      .run(fixture.contact)
    await new CRMAttachments(fixture.db, {} as R2Bucket, 1).stage({
      site: 'default',
      link: { type: 'household', id: 'history-house' },
      operationKey: key(),
      values: {
        filename: 'Fictional private household.txt',
        size: 1,
        sha256: 'a'.repeat(64),
        category: 'communications',
      },
    })
    const endpoint = timelineEndpoints(fixture.db, errorResponse)[0]
    vi.stubGlobal('fetch', async (raw: string) =>
      endpoint.handler({
        url: new URL(raw, 'https://crm.test').href,
        user: { id: 1, collection: 'users' },
      } as PayloadRequest),
    )
    const onOpen = vi.fn()
    render(<ContactTimeline api="/api" site="default" contact={fixture.contact} onOpen={onOpen} />)
    await screen.findByText('Related record: Fictional private household.txt')
    const link = screen.getByRole('link', {
      name: 'Private record attachments (opens in another tab)',
    })
    const url = new URL(link.getAttribute('href')!, 'https://crm.test')
    expect(url.pathname).toBe('/staff/crm')
    expect(url.searchParams.get('site')).toBe('default')
    expect(url.searchParams.get('recordType')).toBe('household')
    expect(url.searchParams.get('recordID')).toBe('history-house')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(onOpen).not.toHaveBeenCalled()
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(fixture.contact)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))
    await screen.findByRole('alert')
    expect(screen.queryByText('Related record: Fictional private household.txt')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  } finally {
    fixture.close()
  }
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
