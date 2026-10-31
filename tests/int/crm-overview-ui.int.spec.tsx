// DOM environment is selected by the dom Vitest project.
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { crmOverview } from '../../src/crm/overview'
import { OverviewWorkspace } from '../../src/crm/OverviewWorkspace'
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('renders complete chapter totals and useful links, then clears private totals after revoked access on refresh', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = await crmTimelineFixture()
  try {
    let denied = false
    const fetchOverview = vi.fn(async () =>
      denied
        ? Response.json({ message: 'Choose an authorized chapter.' }, { status: 403 })
        : Response.json(await crmOverview(fixture.db, 1, 'default', '2026-10-25')),
    )
    vi.stubGlobal('fetch', fetchOverview)
    const first = render(
      <OverviewWorkspace
        api="/api"
        site="default"
        actor="overview-ui-test"
        href={(view) => `/admin/crm?view=${view}&site=default`}
      />,
    )
    const constituent = await screen.findByRole('link', { name: 'Total contacts: 1' })
    expect(constituent.getAttribute('href')).toBe('/admin/crm?view=contacts&site=default')
    expect(
      screen.getByRole('link', { name: 'Record or review donations' }).getAttribute('href'),
    ).toContain('view=donations')
    expect(screen.getByText('No monetary gifts recorded yet.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /0 opportunity actions due today or overdue/ }).getAttribute('href')).toContain('openOnly=true&dueThrough=2026-10-25')
    expect(fetchOverview).toHaveBeenCalledTimes(1)
    first.unmount()
    render(<OverviewWorkspace api="/api" site="default" actor="overview-ui-test" href={(view) => `/admin/crm?view=${view}&site=default`} />)
    expect(await screen.findByRole('link', { name: 'Total contacts: 1' })).toBeTruthy()
    expect(fetchOverview).toHaveBeenCalledTimes(1)
    denied = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('authorized chapter'),
    )
    expect(screen.queryByText('No monetary gifts recorded yet.')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Total contacts: 1' })).toBeNull()
  } finally {
    fixture.close()
  }
})
