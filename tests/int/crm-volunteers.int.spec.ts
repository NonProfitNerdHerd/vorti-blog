import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { activitySchemaV1 } from '../../src/crm/activity-schema-v1'
import { volunteerSchemaV1 } from '../../src/crm/volunteer-schema-v1'
import { VolunteerRepository } from '../../src/crm/volunteers'
import { ContactRepository } from '../../src/crm/contacts'
import { ActivityRepository } from '../../src/crm/activities'
import { OrganizationRepository } from '../../src/organizations/repository'
let fixture: ReturnType<typeof localD1>,
  repo: VolunteerRepository,
  contact: string,
  activity: string
const key = () => crypto.randomUUID()
const profileValues = () => ({
  constituent: contact,
  skills: ['Logistics', 'First aid'],
  interests: ['Food relief'],
  availability: 'Saturday afternoons',
  doNotContact: false,
  archived: false,
})
beforeEach(async () => {
  fixture = localD1()
  fixture.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT);INSERT INTO users VALUES(1,'administrator','Fictional operator'),(2,'editor','Skills viewer');",
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
  await repo.saveProfile({ site: 'default', operationKey: key(), values: profileValues() })
  activity = String(
    (
      await repo.saveActivity({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Fictional food drive',
          description: 'Chapter activity',
          location: 'Fictional center',
          startsOn: '2026-11-01',
          endsOn: '2026-11-03',
          skills: ['Logistics'],
          state: 'planned',
        },
      })
    ).id,
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  fixture.close()
})
const inviteValues = () => ({
  activity,
  constituent: contact,
  channel: 'phone',
  occurredOn: '2026-10-24',
  notes: 'Recorded outreach; no email sent',
  profileRevision: 1,
  activityRevision: 1,
})
it('discovers permitted skills and availability without exposing private communications or hours', async () => {
  await new ActivityRepository(fixture.db, 1).save({
    site: 'default',
    contact,
    operationKey: key(),
    values: {
      kind: 'note',
      subject: 'Private volunteer note',
      body: 'Private staff observations',
      occurredOn: '2026-10-24',
    },
  })
  const authority = new OrganizationRepository(fixture.db, 1),
    revision = () =>
      Number(
        fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
      )
  await authority.setMembership({
    site: 'default',
    user: 2,
    role: 'reader',
    active: true,
    expectedRevision: revision(),
    operationKey: key(),
  })
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    expectedRevision: revision(),
    denied: [
      { category: 'communications', operation: 'read' },
      { category: 'restricted-activity', operation: 'read' },
      { category: 'volunteer-hours', operation: 'read' },
    ],
    operationKey: key(),
  })
  const reader = new VolunteerRepository(fixture.db, 2),
    directory = await reader.profiles('default', 'first aid')
  expect(directory.docs).toHaveLength(1)
  expect(directory.docs[0].availability).toBe('Saturday afternoons')
  expect(JSON.stringify(directory)).not.toContain('Private staff observations')
  const detail = await reader.getProfile('default', contact)
  expect(detail.canNotes).toBe(false)
  expect(detail.canActivity).toBe(false)
  expect(detail.canHours).toBe(false)
  await expect(reader.getActivity('default', activity)).rejects.toThrow()
  await expect(reader.hours('default', '', contact)).rejects.toThrow()
  await expect(reader.invitations('default', '', contact)).rejects.toThrow()
})
it('records outreach and an individual decline without opting out of later activities', async () => {
  const input = { site: 'default', operationKey: key(), values: inviteValues() },
    first = await repo.invite(input)
  expect(await repo.invite(input)).toEqual(first)
  await repo.respond({
    site: 'default',
    id: String(first.id),
    expectedRevision: 1,
    operationKey: key(),
    values: { response: 'declined', respondedOn: '2026-10-25', notes: 'Unavailable that weekend' },
  })
  expect((await repo.getProfile('default', contact)).doc.contact_allowed).toBe(1)
  const second = String(
    (
      await repo.saveActivity({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Later food drive',
          startsOn: '2026-12-01',
          endsOn: '2026-12-01',
          skills: [],
          state: 'planned',
        },
      })
    ).id,
  )
  await repo.invite({
    site: 'default',
    operationKey: key(),
    values: { ...inviteValues(), activity: second },
  })
  expect((await repo.invitations('default', '', contact)).docs).toHaveLength(2)
  expect((await repo.getActivity('default', activity)).participants).toHaveLength(0)
})
it('enforces persistent chapter and shared-contact do-not-contact choices and retains existing responses', async () => {
  const invitation = await repo.invite({
    site: 'default',
    operationKey: key(),
    values: inviteValues(),
  })
  await repo.saveProfile({
    site: 'default',
    id: contact,
    expectedRevision: 1,
    operationKey: key(),
    values: { ...profileValues(), doNotContact: true },
  })
  await expect(
    repo.invite({
      site: 'default',
      operationKey: key(),
      values: { ...inviteValues(), profileRevision: 2 },
    }),
  ).rejects.toThrow('does not allow')
  await repo.respond({
    site: 'default',
    id: String(invitation.id),
    expectedRevision: 1,
    operationKey: key(),
    values: { response: 'declined', respondedOn: '2026-10-25', notes: 'Keep preference' },
  })
  expect((await repo.getProfile('default', contact)).doc.do_not_contact).toBe(1)
  await repo.saveProfile({
    site: 'default',
    id: contact,
    expectedRevision: 2,
    operationKey: key(),
    values: profileValues(),
  })
  const contacts = new ContactRepository(fixture.db, 1),
    person = await contacts.get('default', contact)
  await contacts.updateProfile({
    site: 'default',
    id: contact,
    expectedRevision: person.revision,
    confirmedSharedUpdate: true,
    profile: {
      ...person.profile,
      communication: { ...person.profile.communication, volunteerAllowed: false },
    },
    operationKey: key(),
  })
  expect((await repo.profiles('default', '', '', false, true)).docs).toHaveLength(0)
  await expect(
    repo.invite({
      site: 'default',
      operationKey: key(),
      values: { ...inviteValues(), profileRevision: 3 },
    }),
  ).rejects.toThrow('does not allow')
})
it('requires attended participation, preserves original hours and changes approved totals through reviewed history', async () => {
  await expect(
    repo.submitHours({
      site: 'default',
      operationKey: key(),
      values: { activity, constituent: contact, occurredOn: '2026-11-01', minutes: 90 },
    }),
  ).rejects.toThrow()
  await repo.participate({
    site: 'default',
    operationKey: key(),
    values: {
      activity,
      activityRevision: 1,
      constituent: contact,
      state: 'attended',
      notes: 'Confirmed attendance',
    },
  })
  const input = {
      site: 'default',
      operationKey: key(),
      values: { activity, constituent: contact, occurredOn: '2026-11-01', minutes: 90 },
    },
    submitted = await repo.submitHours(input)
  expect(await repo.submitHours(input)).toEqual(submitted)
  expect((await repo.hours('default', activity)).totals).toEqual([
    { state: 'submitted', records: 1, minutes: '90' },
  ])
  await repo.reviewHours({
    site: 'default',
    id: String(submitted.id),
    expectedRevision: 1,
    operationKey: key(),
    values: { state: 'approved', reason: 'Confirmed by coordinator' },
  })
  expect((await repo.hours('default', activity, '', '', 'approved')).totals[0].minutes).toBe('90')
  await expect(
    repo.reviewHours({
      site: 'default',
      id: String(submitted.id),
      expectedRevision: 1,
      operationKey: key(),
      values: { state: 'rejected', reason: 'Stale review' },
    }),
  ).rejects.toThrow()
  expect(() =>
    fixture.sqlite
      .prepare('UPDATE vc_crm_volunteer_hours SET minutes=30 WHERE id=?')
      .run(String(submitted.id)),
  ).toThrow()
  await repo.reviewHours({
    site: 'default',
    id: String(submitted.id),
    expectedRevision: 2,
    operationKey: key(),
    values: {
      state: 'rejected',
      reason: 'Incorrect entry; record a corrected submission separately',
    },
  })
  expect((await repo.hours('default', activity, '', '', 'approved')).docs).toHaveLength(0)
  expect((await repo.hours('default', activity, '', '', 'rejected')).docs[0].minutes).toBe(90)
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) n FROM vc_platform_audit WHERE record_type='volunteer-hours'")
      .get()!.n,
  ).toBe(3)
})
it('fences consent revoked between outreach validation and commit with no orphan invitation or audit', async () => {
  const count = fixture.sqlite.prepare('SELECT count(*) n FROM vc_platform_audit').get()!.n,
    batch = fixture.db.batch.bind(fixture.db)
  vi.spyOn(fixture.db, 'batch').mockImplementationOnce(async (statements) => {
    fixture.sqlite
      .prepare(
        "UPDATE vc_crm_volunteer_profiles SET do_not_contact=1,revision=revision+1 WHERE site_id='default' AND constituent_id=?",
      )
      .run(contact)
    return batch(statements)
  })
  await expect(
    repo.invite({ site: 'default', operationKey: key(), values: inviteValues() }),
  ).rejects.toThrow()
  expect(
    fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_volunteer_invitations').get()!.n,
  ).toBe(0)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_platform_audit').get()!.n).toBe(count)
})
it('rejects cross-root activity references, stale profile changes and invalid hours', async () => {
  const other = await new OrganizationRepository(fixture.db, 1).createOrganization({
    name: 'Unrelated network',
    siteName: 'Unrelated chapter',
    operationKey: key(),
  })
  await expect(repo.getActivity(String(other.site), activity)).rejects.toThrow()
  await expect(
    repo.participate({
      site: String(other.site),
      operationKey: key(),
      values: { activity, activityRevision: 1, constituent: contact, state: 'attended' },
    }),
  ).rejects.toThrow()
  await repo.saveProfile({
    site: 'default',
    id: contact,
    expectedRevision: 1,
    operationKey: key(),
    values: { ...profileValues(), availability: 'Sunday' },
  })
  await expect(
    repo.saveProfile({
      site: 'default',
      id: contact,
      expectedRevision: 1,
      operationKey: key(),
      values: profileValues(),
    }),
  ).rejects.toThrow()
  for (const minutes of [0, 1.5, 1441])
    await expect(
      repo.submitHours({
        site: 'default',
        operationKey: key(),
        values: { activity, constituent: contact, occurredOn: '2026-11-01', minutes },
      }),
    ).rejects.toThrow('whole minutes')
})
