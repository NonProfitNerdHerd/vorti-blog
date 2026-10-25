// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { CommitmentRepository, commitmentKind } from '../../src/crm/commitments'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
import { CommitmentWorkspace } from '../../src/crm/CommitmentWorkspace'
import { householdSchemaV1 } from '../../src/crm/household-schema-v1'
import { membershipSchemaV1 } from '../../src/crm/membership-schema-v1'
import { MembershipRepository } from '../../src/crm/memberships'
import { MembershipWorkspace } from '../../src/crm/MembershipWorkspace'

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
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT); INSERT INTO users VALUES(1,'administrator','Fictional operator');",
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
  ])
    fixture.sqlite.exec(sql)
  const db = fixture.db,
    finance = new FinanceRepository(db, 1),
    repo = new CommitmentRepository(db, 1),
    memberships = new MembershipRepository(db, 1),
    key = () => crypto.randomUUID()
  contact = String(
    (
      await new ContactRepository(db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional donor' },
        roles: ['donor'],
        operationKey: key(),
      })
    ).id,
  )
  const fund = String(
    (await finance.createFund({ site: 'default', name: 'General', operationKey: key() })).id,
  )
  await finance.createGift({
    site: 'default',
    constituent: contact,
    amount: { currency: 'USD', minorUnits: '1000' },
    exponent: 2,
    kind: 'cash',
    receivedOn: '2026-02-01',
    allocations: [{ currency: 'USD', minorUnits: '1000', fund }],
    operationKey: key(),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost'),
        site = url.searchParams.get('site') || 'default'
      try {
        if (url.pathname.endsWith('/contacts'))
          return Response.json(
            await new ContactRepository(db, 1).list({
              site,
              search: url.searchParams.get('search') || '',
              limit: 25,
            }),
          )
        if (url.pathname.endsWith('/households')) return Response.json({ docs: [], next: null })
        if (url.pathname.endsWith('/memberships')) {
          if (init?.method === 'POST') {
            const b = JSON.parse(String(init.body)),
              common = { site: b.site, operationKey: b.operationKey }
            const doc =
              b.action === 'save-type'
                ? await memberships.saveType({
                    ...common,
                    id: b.id,
                    expectedRevision: b.expectedRevision,
                    values: b.values,
                  })
                : b.action === 'enroll'
                  ? await memberships.enroll({ ...common, values: b.values })
                  : await memberships.cancel(b)
            return Response.json({ doc })
          }
          const id = url.searchParams.get('id'),
            asOf = url.searchParams.get('asOf') || ''
          return Response.json(
            url.searchParams.get('view') === 'types'
              ? await memberships.types(site, url.searchParams.get('after') || '')
              : id
                ? await memberships.get(site, id, asOf)
                : await memberships.list(
                    site,
                    asOf,
                    url.searchParams.get('status') || 'all',
                    url.searchParams.get('after') || '',
                    url.searchParams.get('contact') || '',
                  ),
          )
        }
        if (url.pathname.endsWith('/fundraising')) return Response.json({ docs: [], next: null })
        if (url.pathname.endsWith('/finance'))
          return Response.json(
            url.searchParams.get('id')
              ? { doc: await finance.get(site, url.searchParams.get('id')!) }
              : await finance.list({
                  site,
                  constituent: contact,
                  page: Number(url.searchParams.get('page') || 1),
                  limit: 25,
                }),
          )
        if (init?.method === 'POST') {
          const b = JSON.parse(String(init.body))
          const common = { site: b.site, operationKey: b.operationKey }
          const doc =
            b.action === 'create'
              ? await repo.create({ ...common, values: b.values })
              : b.action === 'apply-payment' || b.action === 'reverse-payment'
                ? await repo.apply({
                    ...b,
                    reverseApplication: b.action === 'reverse-payment' ? b.application : undefined,
                  })
                : await repo.change({ ...b })
          return Response.json({ doc })
        }
        const id = url.searchParams.get('id')
        return Response.json(
          url.searchParams.get('view') === 'history'
            ? await repo.history(
                site,
                id!,
                url.searchParams.has('afterID')
                  ? {
                      id: url.searchParams.get('afterID')!,
                      createdAt: url.searchParams.get('afterCreatedAt')!,
                    }
                  : undefined,
              )
            : id
              ? await repo.get(
                  site,
                  id,
                  url.searchParams.get('through')!,
                  Number(url.searchParams.get('offset') || 0),
                )
              : await repo.list(
                  site,
                  commitmentKind(url.searchParams.get('kind')!),
                  url.searchParams.get('after') || '',
                  url.searchParams.get('contact') || '',
                ),
        )
      } catch (cause) {
        return Response.json(
          { message: (cause as Error).message },
          { status: (cause as { status?: number }).status || 400 },
        )
      }
    }),
  )
})
it('creates a membership type, enrolls a term, opens its unpaid dues and renews without rewriting the prior term', async () => {
  render(<MembershipWorkspace api="/api" site="default" contact={contact} />)
  await screen.findByRole('button', { name: 'Enroll membership' })
  fireEvent.click(screen.getByText('Membership types', { selector: 'summary' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create membership type' }))
  fill('Type name', 'Fictional annual membership')
  fill('Dues amount', '10.00')
  fireEvent.click(screen.getByRole('button', { name: 'Save membership type' }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Save membership type' })).toBeNull(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Enroll membership' }))
  const select = screen.getByLabelText('Membership type')
  const choice = within(select).getByRole('option', { name: 'Fictional annual membership' })
  fireEvent.change(select, { target: { value: choice.getAttribute('value') } })
  fill('Term starts on', '2026-01-01')
  fireEvent.click(screen.getByRole('button', { name: 'Use type term length' }))
  expect((screen.getByLabelText('Term ends on (optional)') as HTMLInputElement).value).toBe(
    '2026-12-31',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save membership term' }))
  await screen.findByRole('region', { name: 'Membership term details' })
  fireEvent.click(screen.getByRole('button', { name: 'Manage recorded dues payments' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open membership dues' }))
  await screen.findByRole('region', { name: 'Giving record details' })
  expect(value('Recorded payment credit')).toBe('USD 0.00')
  expect(value('Outstanding')).toBe('USD 10.00')
  fireEvent.click(screen.getByRole('button', { name: 'Renew membership' }))
  expect((screen.getByLabelText('Term starts on') as HTMLInputElement).value).toBe('2027-01-01')
  fireEvent.click(screen.getByRole('button', { name: 'Save membership term' }))
  await screen.findByRole('region', { name: 'Membership term details' })
  expect(screen.getByRole('button', { name: 'Open previous term' })).toBeTruthy()
  expect(
    (await fixture.db
      .prepare('SELECT count(*) n FROM vc_crm_membership_terms')
      .first<{ n: number }>())!.n,
  ).toBe(2)
  expect(
    (await fixture.db.prepare('SELECT count(*) n FROM vc_crm_gifts').first<{ n: number }>())!.n,
  ).toBe(1)
})
afterEach(() => {
  cleanup()
  fixture.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } })
const value = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling!.textContent
it('creates editable pledge installments, applies a recorded gift and reloads persisted balances', async () => {
  const mount = () => render(<CommitmentWorkspace api="/api" site="default" contact={contact} />)
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Create pledge' }))
  fill('Name', 'Fictional annual pledge')
  fill('Total pledged', '10.00')
  fill('Starts on', '2026-01-31')
  fill('Installment count', '2')
  fireEvent.click(screen.getByRole('button', { name: 'Generate installments' }))
  expect((screen.getByLabelText('Installment 1 amount') as HTMLInputElement).value).toBe('5.00')
  expect((screen.getByLabelText('Installment 2 date') as HTMLInputElement).value).toBe('2026-02-28')
  fireEvent.click(screen.getByRole('button', { name: 'Save giving record' }))
  await screen.findByRole('region', { name: 'Giving record details' })
  expect(value('Outstanding')).toBe('USD 10.00')
  fireEvent.click(screen.getByRole('button', { name: 'Load donor gifts' }))
  const select = screen.getByLabelText('Gift')
  await waitFor(() => expect(within(select).getAllByRole('option').length).toBe(2))
  fireEvent.change(select, {
    target: { value: within(select).getAllByRole('option')[1].getAttribute('value') },
  })
  const period = screen.getByLabelText('Apply to period')
  fireEvent.change(period, {
    target: {
      value: (within(period).getByRole('option', { name: '2026-01-31' }) as HTMLOptionElement)
        .value,
    },
  })
  fill('Payment amount', '5.00')
  fill('Reason', 'Apply the first installment')
  fireEvent.click(screen.getByRole('button', { name: 'Apply recorded payment' }))
  await waitFor(() => expect(value('Outstanding')).toBe('USD 5.00'))
  cleanup()
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Fictional annual pledge' }))
  await screen.findByRole('region', { name: 'Giving record details' })
  expect(value('Recorded payment credit')).toBe('USD 5.00')
  expect(screen.queryByRole('alert')).toBeNull()
  // The donor gift list is intentionally not loaded after remount. Resolve the
  // retained application directly instead of searching for its original page.
  const originalGifts = fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts').all()
  fireEvent.click(screen.getByRole('button', { name: 'Load source gift' }))
  await screen.findByText(/USD 10.00 current net/)
  expect(value('Recorded payment credit')).toBe('USD 5.00')
  fill('Reason', 'Correct application to the wrong installment')
  fireEvent.click(screen.getByRole('button', { name: 'Reverse application' }))
  await waitFor(() => expect(value('Recorded payment credit')).toBe('USD 0.00'))
  expect(value('Outstanding')).toBe('USD 10.00')
  const updatedGifts = fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts').all()
  const financialSnapshot = (rows: unknown[]) =>
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row as Record<string, unknown>).filter(
          ([key]) => !['revision', 'updated_at'].includes(key),
        ),
      ),
    )
  expect(financialSnapshot(updatedGifts)).toEqual(financialSnapshot(originalGifts))
  expect((updatedGifts[0] as { revision: number }).revision).toBe(
    (originalGifts[0] as { revision: number }).revision + 1,
  )
  expect(screen.getByText(/Apply the first installment \(reversed\)/)).toBeTruthy()
  await within(screen.getByRole('region', { name: 'Giving change history' })).findByText(
    'Correct application to the wrong installment',
  )
  expect(
    fixture.sqlite
      .prepare("SELECT reason FROM vc_platform_audit WHERE action='giving.payment-reversed'")
      .get(),
  ).toEqual({ reason: 'Correct application to the wrong installment' })
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost')
    return url.pathname.endsWith('/finance') && url.searchParams.has('id')
      ? Response.json({ message: 'Financial access revoked.' }, { status: 403 })
      : originalFetch(input, init)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Load source gift' }))
  await screen.findByText('Financial access revoked.')
  expect(screen.queryByRole('region', { name: 'Giving record details' })).toBeNull()
  expect(fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts').all()).toEqual(updatedGifts)
})
it('creates recurring giving and exposes audited pause/resume controls without creating gifts', async () => {
  render(<CommitmentWorkspace api="/api" site="default" contact={contact} />)
  fireEvent.click(screen.getByRole('button', { name: 'Recurring schedules' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Create recurring schedule' }))
  fill('Name', 'Fictional monthly support')
  fill('Amount per period', '10.00')
  fill('Starts on', '2026-01-31')
  fill('Ends on (optional)', '2026-04-30')
  fireEvent.click(screen.getByRole('button', { name: 'Save giving record' }))
  await screen.findByRole('region', { name: 'Giving record details' })
  expect(value('Expected')).toBe('USD 40.00')
  fill('Effective date', '2026-02-01')
  fill('Reason', 'Temporary pause')
  fireEvent.click(screen.getByRole('button', { name: 'Pause schedule' }))
  await waitFor(() => expect(value('Expected')).toBe('USD 10.00'))
  fill('Effective date', '2026-03-31')
  fill('Reason', 'Resume support')
  fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }))
  await waitFor(() => expect(value('Expected')).toBe('USD 30.00'))
  expect(
    (await fixture.db.prepare('SELECT count(*) n FROM vc_crm_gifts').first<{ n: number }>())!.n,
  ).toBe(1)
})
