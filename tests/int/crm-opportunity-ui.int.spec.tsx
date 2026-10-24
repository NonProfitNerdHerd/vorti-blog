// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { opportunitySchemaV1 } from '../../src/crm/opportunity-schema-v1'
import { OpportunityWorkspace } from '../../src/crm/OpportunityWorkspace'
import { opportunityEndpoints } from '../../src/crm/opportunity-endpoints'
import { errorResponse } from '../../src/crm/plugin'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
let fixture: ReturnType<typeof localD1>, contact: string
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fixture = localD1()
  fixture.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT);INSERT INTO users VALUES(1,'administrator','Fictional operator');",
  )
  for (const s of [
    ...organizationSchema,
    ...defaultOrganizationSeed,
    ...contactSchemaV1,
    ...financeSchemaV1,
    ...fundraisingSchemaV1,
    ...commitmentSchemaV1,
    ...opportunitySchemaV1,
  ])
    fixture.sqlite.exec(s)
  contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional prospect' },
        roles: ['donor'],
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  const endpoints = opportunityEndpoints(fixture.db, errorResponse),
    finance = new FinanceRepository(fixture.db, 1)
  const fund = String(
    (
      await finance.createFund({
        site: 'default',
        name: 'General',
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  await finance.createGift({
    site: 'default',
    constituent: contact,
    amount: { currency: 'USD', minorUnits: '1000' },
    exponent: 2,
    kind: 'cash',
    receivedOn: '2026-10-24',
    allocations: [{ fund, currency: 'USD', minorUnits: '1000' }],
    operationKey: crypto.randomUUID(),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost')
      if (url.pathname === '/api/crm/fundraising') return Response.json({ docs: [], next: null })
      if (url.pathname === '/api/crm/finance')
        return Response.json(
          await finance.list({
            site: 'default',
            constituent: contact,
            page: Number(url.searchParams.get('page') || 1),
            limit: 25,
          }),
        )
      const endpoint = endpoints.find(
        (e) => e.method === (init?.method === 'POST' ? 'post' : 'get'),
      )!
      const incoming = new Request(url, {
        ...init,
        headers: { ...init?.headers, origin: 'http://localhost' },
      })
      return endpoint.handler({
        user: { id: 1, collection: 'users' },
        url: url.href,
        headers: incoming.headers,
        body: incoming.body,
      } as PayloadRequest)
    }),
  )
})
afterEach(() => {
  cleanup()
  fixture.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } })
async function createOpportunity() {
  render(<OpportunityWorkspace api="/api" site="default" contact={contact} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create pipeline' }))
  fill('Pipeline name', 'Major gifts')
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Create opportunity' }))
  fill('Opportunity name', 'Fictional proposal')
  fill('Expected amount (optional)', '123.45')
  fill('Next action', 'Arrange meeting')
  fill('Next action date', '2026-11-01')
  fireEvent.click(screen.getByRole('button', { name: 'Save opportunity' }))
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Opportunity editor' })).toBeNull(),
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Fictional proposal' }))
  await screen.findByRole('region', { name: 'Opportunity editor' })
}
it('creates, reloads and moves an opportunity with stage history and no implicit revenue', async () => {
  await createOpportunity()
  expect((screen.getByLabelText('Expected amount (optional)') as HTMLInputElement).value).toBe(
    '123.45',
  )
  const stages = screen.getByRole('combobox', { name: 'Opportunity stage' })
  fireEvent.change(stages, {
    target: {
      value: (within(stages).getByRole('option', { name: 'Received' }) as HTMLOptionElement).value,
    },
  })
  fill('Stage change reason', 'Recorded planning outcome only')
  fireEvent.click(screen.getByRole('button', { name: 'Save opportunity' }))
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Opportunity editor' })).toBeNull(),
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Pipeline view' }))
  const column = screen.getByRole('region', { name: 'Received stage' })
  fireEvent.click(within(column).getByRole('button', { name: 'Fictional proposal' }))
  await screen.findByText('Recorded planning outcome only')
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_gifts').get()!.n).toBe(1)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_commitments').get()!.n).toBe(0)
  expect(screen.queryByRole('alert')).toBeNull()
})
it('links an existing gift explicitly, preserves dirty-link guards and retains unlink history', async () => {
  await createOpportunity()
  fireEvent.click(screen.getByRole('button', { name: 'Load recorded gifts' }))
  const chooser = screen.getByRole('combobox', { name: 'Financial record' })
  await waitFor(() => expect(within(chooser).getAllByRole('option')).toHaveLength(2))
  fireEvent.change(chooser, {
    target: { value: (within(chooser).getAllByRole('option')[1] as HTMLOptionElement).value },
  })
  fill('Financial link reason', 'Existing received gift')
  expect(screen.getByLabelText('Opportunity name').matches(':disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Link recorded record' }))
  await screen.findByText(/Existing received gift/)
  await waitFor(() =>
    expect(screen.getByLabelText('Opportunity name').matches(':disabled')).toBe(false),
  )
  fill('Financial link reason', 'Remove wrong attribution')
  fireEvent.click(screen.getByRole('button', { name: 'Remove financial link' }))
  await screen.findByText(/removed: Existing received gift/)
  expect(
    fixture.sqlite.prepare('SELECT removed FROM vc_crm_opportunity_links').get()!.removed,
  ).toBe(1)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_gifts').get()!.n).toBe(1)
  expect(screen.queryByRole('alert')).toBeNull()
})
