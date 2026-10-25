// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConstituentSummary } from '../../src/crm/ConstituentSummary'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { crmOverview } from '../../src/crm/overview'
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
it('shows the selected constituent summary, opens call notes and history, and clears it after affiliation revocation', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = await crmTimelineFixture(),
    onOpen = vi.fn(),
    onUnavailable = vi.fn()
  try {
    vi.stubGlobal('fetch', async (url: string) => {
      const params = new URL(url, 'https://crm.test').searchParams
      expect(params.get('contact')).toBe(fixture.contact)
      try {
        return Response.json(
          await crmOverview(fixture.db, 1, 'default', '2026-10-25', fixture.contact),
        )
      } catch {
        return Response.json({ message: 'Constituent unavailable.' }, { status: 403 })
      }
    })
    render(
      <ConstituentSummary
        api="/api"
        site="default"
        contact={fixture.contact}
        roles={['donor', 'volunteer']}
        onOpen={onOpen}
        onUnavailable={onUnavailable}
      />,
    )
    await screen.findByText('0 posted monetary gifts')
    expect(screen.getByText('donor · volunteer')).toBeTruthy()
    for (const [name, target] of [
      ['View or record gifts', 'gifts'],
      ['View pledges and recurring giving', 'giving'],
      ['Review opportunities', 'opportunities'],
      ['Review memberships and renewals', 'memberships'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(onOpen).toHaveBeenLastCalledWith(target)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Record a call or note' }))
    expect(onOpen).toHaveBeenLastCalledWith('communications')
    fireEvent.click(screen.getByRole('button', { name: 'Open timeline' }))
    expect(onOpen).toHaveBeenLastCalledWith('timeline')
    fixture.sqlite
      .prepare(
        'UPDATE vc_crm_affiliations SET archived=1,revision=revision+1 WHERE constituent_id=?',
      )
      .run(fixture.contact)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh summary' }))
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledOnce())
    expect(screen.queryByText('0 posted monetary gifts')).toBeNull()
  } finally {
    fixture.close()
  }
})
