import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { volunteerSchemaV1 } from '../../src/crm/volunteer-schema-v1'
import { VolunteerRepository } from '../../src/crm/volunteers'
import { ContactRepository } from '../../src/crm/contacts'
let proxy: PlatformProxy<{ D1: D1Database }>, db: D1Database
beforeAll(async () => {
  proxy = await getPlatformProxy<{ D1: D1Database }>({
    configPath: 'tests/fixtures/organization-worker/wrangler.jsonc',
    persist: false,
    remoteBindings: false,
  })
  db = proxy.env.D1
  const schema = [
    'CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT)',
    "INSERT INTO users VALUES(1,'administrator','Fictional operator')",
    ...organizationSchema,
    ...defaultOrganizationSeed,
    ...contactSchemaV1,
    ...volunteerSchemaV1,
  ]
  for (let i = 0; i < schema.length; i += 25)
    await db.batch(schema.slice(i, i + 25).map((s) => db.prepare(s)))
}, 90000)
afterAll(async () => {
  await proxy?.dispose()
})
it('records consent, outreach, attendance and approved minutes on D1 with rollback and retry-safe histories', async () => {
  const key = () => crypto.randomUUID(),
    repo = new VolunteerRepository(db, 1)
  const contact = String(
    (
      await new ContactRepository(db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional D1 volunteer' },
        roles: ['volunteer'],
        operationKey: key(),
      })
    ).id,
  )
  const profile = {
    constituent: contact,
    skills: ['Logistics'],
    interests: [] as string[],
    availability: 'Weekends',
  }
  await repo.saveProfile({ site: 'default', operationKey: key(), values: profile })
  const activity = String(
    (
      await repo.saveActivity({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'D1 food drive',
          startsOn: '2026-11-01',
          endsOn: '2026-11-01',
          skills: [],
          state: 'planned',
        },
      })
    ).id,
  )
  const invite = {
    site: 'default',
    operationKey: key(),
    values: {
      activity,
      constituent: contact,
      profileRevision: 1,
      activityRevision: 1,
      channel: 'phone',
      occurredOn: '2026-10-24',
      notes: 'Recorded staff call',
    },
  }
  const invitation = await repo.invite(invite)
  expect(await repo.invite(invite)).toEqual(invitation)
  await repo.respond({
    site: 'default',
    id: String(invitation.id),
    expectedRevision: 1,
    operationKey: key(),
    values: { response: 'declined', respondedOn: '2026-10-25', notes: 'Unavailable' },
  })
  expect((await repo.profiles('default', 'logistics')).docs[0].contact_allowed).toBe(1)
  await repo.participate({
    site: 'default',
    operationKey: key(),
    values: {
      activity,
      activityRevision: 1,
      constituent: contact,
      state: 'attended',
      notes: 'Staff recorded attendance',
    },
  })
  const submit = {
      site: 'default',
      operationKey: key(),
      values: { activity, constituent: contact, occurredOn: '2026-11-01', minutes: 75 },
    },
    hours = await repo.submitHours(submit)
  expect(await repo.submitHours(submit)).toEqual(hours)
  await repo.reviewHours({
    site: 'default',
    id: String(hours.id),
    expectedRevision: 1,
    operationKey: key(),
    values: { state: 'approved', reason: 'Coordinator verified' },
  })
  const audit = await db.prepare('SELECT count(*) n FROM vc_platform_audit').first()
  await expect(
    repo.reviewHours({
      site: 'default',
      id: String(hours.id),
      expectedRevision: 1,
      operationKey: key(),
      values: { state: 'rejected', reason: 'Stale review' },
    }),
  ).rejects.toThrow()
  expect(await db.prepare('SELECT count(*) n FROM vc_platform_audit').first()).toEqual(audit)
  expect((await repo.hours('default', activity)).totals).toEqual([
    { state: 'approved', records: 1, minutes: '75' },
  ])
  await repo.saveProfile({
    site: 'default',
    id: contact,
    expectedRevision: 1,
    operationKey: key(),
    values: { ...profile, doNotContact: true },
  })
  await expect(
    repo.invite({
      ...invite,
      operationKey: key(),
      values: { ...invite.values, profileRevision: 2 },
    }),
  ).rejects.toThrow('does not allow')
}, 90000)
