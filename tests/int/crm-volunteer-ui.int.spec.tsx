// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { activitySchemaV1 } from '../../src/crm/activity-schema-v1'
import { volunteerSchemaV1 } from '../../src/crm/volunteer-schema-v1'
import { VolunteerWorkspace } from '../../src/crm/VolunteerWorkspace'
import { VolunteerRepository } from '../../src/crm/volunteers'
import { ContactRepository } from '../../src/crm/contacts'
import { volunteerEndpoints } from '../../src/crm/volunteer-endpoints'
import { errorResponse } from '../../src/crm/plugin'
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
let fixture: ReturnType<typeof localD1>,
  contact: string,
  activity: string,
  repo: VolunteerRepository
const key = () => crypto.randomUUID()
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
    ...activitySchemaV1,
    ...volunteerSchemaV1,
  ])
    fixture.sqlite.exec(s)
  repo = new VolunteerRepository(fixture.db, 1)
  contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional volunteer' },
        roles: ['volunteer'],
        operationKey: key(),
      })
    ).id,
  )
  await repo.saveProfile({
    site: 'default',
    operationKey: key(),
    values: {
      constituent: contact,
      skills: ['Logistics'],
      interests: ['Food relief'],
      availability: 'Saturday',
    },
  })
  activity = String(
    (
      await repo.saveActivity({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Fictional food drive',
          startsOn: '2026-11-01',
          endsOn: '2026-11-03',
          state: 'planned',
          skills: ['Logistics'],
        },
      })
    ).id,
  )
  const endpoints = volunteerEndpoints(fixture.db, errorResponse)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost'),
        endpoint = endpoints.find((e) => e.method === (init?.method === 'POST' ? 'post' : 'get'))!
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
const mount = () => render(<VolunteerWorkspace api="/api" site="default" contact={contact} />)
it('edits discoverable skills and persistent chapter preferences and reloads the saved profile', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Fictional volunteer' }))
  await screen.findByRole('region', { name: 'Volunteer profile editor' })
  fill('Skills (comma separated)', 'Logistics, First aid')
  fill('Availability (discoverable)', 'Weekends after noon')
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Do not contact for volunteer opportunities in this chapter',
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save volunteer profile' }))
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Volunteer profile editor' })).toBeNull(),
  )
  cleanup()
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Fictional volunteer' }))
  await screen.findByRole('region', { name: 'Volunteer profile editor' })
  expect((screen.getByLabelText('Skills (comma separated)') as HTMLInputElement).value).toBe(
    'Logistics, First aid',
  )
  expect(
    (screen.getByRole('textbox', { name: 'Availability (discoverable)' }) as HTMLTextAreaElement)
      .value,
  ).toBe('Weekends after noon')
  expect(
    (
      screen.getByRole('checkbox', {
        name: 'Do not contact for volunteer opportunities in this chapter',
      }) as HTMLInputElement
    ).checked,
  ).toBe(true)
})
it('creates an activity, records attendance, submits minutes and approves them without rewriting the submission', async () => {
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Chapter activities' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Create volunteer activity' }))
  fill('Activity name', 'Fictional cleanup')
  fill('Activity starts on', '2026-11-02')
  fill('Activity ends on', '2026-11-02')
  fireEvent.click(screen.getByRole('button', { name: 'Save volunteer activity' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Register volunteer participation' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Participation status' }), {
    target: { value: 'attended' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save participation' }))
  await screen.findByRole('cell', { name: 'attended' })
  fireEvent.click(screen.getByRole('button', { name: 'Activity hours' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Record volunteer hours' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Attended volunteer' }), {
    target: { value: contact },
  })
  fill('Hours occurred on', '2026-11-02')
  fill('Whole minutes', '90')
  fireEvent.click(screen.getByRole('button', { name: 'Submit volunteer hours' }))
  await screen.findByText('submitted: 1 h 30 min (1 records)')
  fireEvent.click(screen.getByRole('button', { name: 'Review Fictional volunteer 2026-11-02' }))
  fill('Hours review reason', 'Attendance and time confirmed')
  fireEvent.click(screen.getByRole('button', { name: 'Save hours review' }))
  await screen.findByText('approved: 1 h 30 min (1 records)')
  const hour = fixture.sqlite
    .prepare('SELECT minutes,state,revision FROM vc_crm_volunteer_hours')
    .get()!
  expect(hour).toEqual({ minutes: 90, state: 'approved', revision: 2 })
  cleanup()
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Hours and approvals' }))
  await screen.findByRole('cell', { name: '1 h 30 min' })
  expect(screen.queryByRole('alert')).toBeNull()
})
it('records outreach and a decline separately from a later do-not-contact preference', async () => {
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Chapter activities' }))
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Only activities with this contact’s recorded participation',
    }),
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Fictional food drive' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Invitations and responses' }))
  fireEvent.click(screen.getByRole('button', { name: 'Record outreach invitation' }))
  const chooser = screen.getByRole('combobox', { name: 'Outreach volunteer' })
  await waitFor(() => expect(within(chooser).getAllByRole('option')).toHaveLength(2))
  fireEvent.change(chooser, { target: { value: contact } })
  fill('Outreach occurred on', '2026-10-24')
  fill('Recorded outreach details', 'Called about food drive')
  fireEvent.click(screen.getByRole('button', { name: 'Save recorded invitation' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Record response for Fictional volunteer' }),
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'Invitation response' }), {
    target: { value: 'declined' },
  })
  fill('Response received on', '2026-10-25')
  fill('Response details', 'Unavailable for this activity')
  fireEvent.click(screen.getByRole('button', { name: 'Save invitation response' }))
  await screen.findByText('Unavailable for this activity')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Skills and discovery' }).matches(':disabled')).toBe(
      false,
    ),
  )
  expect((await repo.getProfile('default', contact)).doc.contact_allowed).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Skills and discovery' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Fictional volunteer' }))
  await screen.findByRole('region', { name: 'Volunteer profile editor' })
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Do not contact for volunteer opportunities in this chapter',
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save volunteer profile' }))
  await waitFor(async () =>
    expect((await repo.getProfile('default', contact)).doc.contact_allowed).toBe(0),
  )
  expect((await repo.invitations('default', activity)).docs[0].response).toBe('declined')
  expect(screen.queryByRole('alert')).toBeNull()
})
