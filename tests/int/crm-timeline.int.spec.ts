import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { ContactTimeline } from '../../src/crm/timeline'
import { ActivityRepository } from '../../src/crm/activities'
import { FinanceRepository } from '../../src/crm/finance'
import { OrganizationRepository } from '../../src/organizations/repository'
import type { TimelineEvent } from '../../src/crm/timeline-model'
import { CorrespondenceRepository } from '../../src/crm/correspondence'
import { CorrespondenceDocuments } from '../../src/crm/correspondence-documents'
import { CRMAttachments } from '../../src/crm/attachments'
import { ContactRepository } from '../../src/crm/contacts'
import { HouseholdRepository } from '../../src/crm/households'
import { MembershipRepository } from '../../src/crm/memberships'
import { OpportunityRepository } from '../../src/crm/opportunities'
import { VolunteerRepository } from '../../src/crm/volunteers'

let fixture: Awaited<ReturnType<typeof crmTimelineFixture>>, timeline: ContactTimeline
const key = () => crypto.randomUUID()
beforeEach(async () => {
  fixture = await crmTimelineFixture()
  timeline = new ContactTimeline(fixture.db, 1)
})
afterEach(() => {
  fixture.close()
  vi.restoreAllMocks()
})
const note = (subject: string, site = 'default') =>
  new ActivityRepository(fixture.db, 1).save({
    site,
    contact: fixture.contact,
    operationKey: key(),
    values: { kind: 'note', subject, body: 'Fictional private note', occurredOn: '2026-10-24' },
  })
async function gift(
  currency = 'USD',
  minorUnits = '90071992547409931',
  exponent = 2,
  kind: 'cash' | 'in-kind' = 'cash',
) {
  const finance = new FinanceRepository(fixture.db, 1)
  const fund = String(
    (await finance.createFund({ site: 'default', name: key(), operationKey: key() })).id,
  )
  return String(
    (
      await finance.createGift({
        site: 'default',
        constituent: fixture.contact,
        kind,
        receivedOn: '2026-10-24',
        amount: { currency, minorUnits },
        exponent,
        allocations: [{ fund, currency, minorUnits }],
        reference: 'Fictional timeline gift',
        operationKey: key(),
      })
    ).id,
  )
}
it('retains complete paginated authorized history, business dates and unknown legacy timestamps', async () => {
  for (let index = 0; index < 70; index++) await note(`Fictional note ${index}`)
  const rows: TimelineEvent[] = []
  let page = await timeline.list({ site: 'default', contact: fixture.contact })
  const total = page.total
  expect(total).toBe(72)
  while (true) {
    rows.push(...page.docs)
    if (!page.next) break
    page = await timeline.list({ site: 'default', contact: fixture.contact, before: page.next })
  }
  expect(rows).toHaveLength(total)
  expect(new Set(rows.map((row) => row.id)).size).toBe(total)
  expect(rows.filter((row) => row.group === 'communications')).toHaveLength(70)
  expect(rows.find((row) => row.group === 'communications')!.effectiveOn).toBe('2026-10-24')
  fixture.sqlite
    .prepare(
      "INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,after_value,operation_key,created_at) SELECT ?,organization_id,'default',1,'contact.chapter.updated','constituent',?,'{}',?,'legacy unknown date' FROM vc_sites WHERE id='default'",
    )
    .run(key(), fixture.contact, key())
  const legacy = await timeline.list({
    site: 'default',
    contact: fixture.contact,
    group: 'profile',
  })
  expect(legacy.total).toBe(3)
  expect(legacy.docs.find((row) => row.title === 'Chapter details updated')!.at).toBeNull()
  expect(legacy.docs.at(-1)!.at).toBeNull()
})
it('keeps exact currencies and gift adjustments distinct from in-kind valuations', async () => {
  const usd = await gift(),
    jpy = await gift('JPY', '101', 0),
    inkind = await gift('USD', '50000', 2, 'in-kind')
  await new FinanceRepository(fixture.db, 1).adjust({
    site: 'default',
    id: usd,
    action: 'refund',
    deltaMinor: '-31',
    reason: 'Fictional partial refund',
    expectedRevision: 1,
    operationKey: key(),
  })
  const page = await timeline.list({ site: 'default', contact: fixture.contact, group: 'giving' })
  expect(page.total).toBe(4)
  expect(
    page.docs.find((row) => row.targetID === usd && row.moneyRole === 'received-gift')!.amount,
  ).toBe('USD 900719925474099.31')
  expect(page.docs.find((row) => row.targetID === jpy)!.amount).toBe('JPY 101')
  expect(page.docs.find((row) => row.targetID === inkind)!.amount).toBeNull()
  expect(page.docs.find((row) => row.moneyRole === 'gift-adjustment')!.amount).toBe('USD -0.31')
})
it('filters restricted sources before counts and rejects cursors after an authority change', async () => {
  await note('Fictional confidential note')
  await gift()
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
  const reader = new ContactTimeline(fixture.db, 2)
  const before = await reader.list({ site: 'default', contact: fixture.contact })
  const cursor = {
    date: before.docs[0].at!,
    id: before.docs[0].id,
    revision: (await authority.require('default', 'identity', 'read')).authorityRevision,
  }
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [
      { category: 'communications', operation: 'read' },
      { category: 'finances', operation: 'read' },
    ],
    expectedRevision: revision(),
    operationKey: key(),
  })
  const page = await reader.list({ site: 'default', contact: fixture.contact })
  expect(page.total).toBe(2)
  expect(page.docs.every((row) => row.group === 'profile')).toBe(true)
  expect(page.groups).not.toContain('giving')
  expect(page.groups).not.toContain('communications')
  await expect(
    reader.list({ site: 'default', contact: fixture.contact, before: cursor }),
  ).rejects.toThrow('changed')
})
it('separates chapter history even for the same shared constituent identity', async () => {
  await note('Main chapter private note')
  await gift()
  fixture.sqlite.exec(
    "INSERT INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at) SELECT 'other',organization_id,id,'Other chapter','other','2026-10-24','2026-10-24' FROM vc_sites WHERE id='default';INSERT INTO vc_site_ancestry VALUES('other','other',0),('default','other',1)",
  )
  fixture.sqlite
    .prepare(
      "INSERT INTO vc_crm_affiliations(id,organization_id,site_id,constituent_id,created_at,updated_at) SELECT ?,organization_id,'other',constituent_id,created_at,updated_at FROM vc_crm_affiliations WHERE site_id='default' AND constituent_id=?",
    )
    .run(key(), fixture.contact)
  await note('Other chapter private note', 'other')
  const main = await timeline.list({ site: 'default', contact: fixture.contact }),
    other = await timeline.list({ site: 'other', contact: fixture.contact })
  expect(main.docs.some((row) => row.label === 'Other chapter private note')).toBe(false)
  expect(other.docs.some((row) => row.label === 'Main chapter private note')).toBe(false)
  expect(other.docs.some((row) => row.group === 'giving')).toBe(false)
  expect(other.total).toBe(2)
})

it('checks document sensitivity and attachment classification without exposing another uploader draft', async () => {
  const giftID = await gift('USD', '100', 2),
    documents = new CorrespondenceDocuments(fixture.db, 1)
  const issued: string[] = []
  for (const kind of ['general', 'gift-receipt']) {
    const template = String(
      (
        await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
          site: 'default',
          operationKey: key(),
          values: {
            name: kind,
            kind,
            subject: `Fictional ${kind} correspondence`,
            body: 'Dear {{recipient.name}}',
          },
        })
      ).id,
    )
    const request = {
      site: 'default',
      contact: fixture.contact,
      template,
      issuerName: 'Fictional organization',
      issuerAddress: '',
      issuedOn: '2026-10-24',
      ...(kind === 'gift-receipt' ? { gift: giftID } : {}),
    }
    const preview = await documents.preview(request)
    const document = String(
      (await documents.issue({ ...request, approval: preview.approval, operationKey: key() })).id,
    )
    issued.push(document)
    const outbox = key()
    fixture.sqlite
      .prepare(
        "INSERT INTO vc_crm_email_outbox(id,site_id,document_id,actor_id,constituent_id,provider,settings_revision,contact_revision,payload,payload_hash,idempotency_key,next_attempt_at,created_at,updated_at) VALUES(?,'default',?,1,?,'resend',1,1,'{}',?,?,? ,?,?)",
      )
      .run(
        outbox,
        document,
        fixture.contact,
        'a'.repeat(64),
        key(),
        '2026-10-24T00:00:00.000Z',
        '2026-10-24T00:00:00.000Z',
        '2026-10-24T00:00:00.000Z',
      )
    fixture.sqlite
      .prepare(
        "INSERT INTO vc_crm_email_events(id,outbox_id,fence,event,detail,created_at) VALUES(?,?,0,'queued','','2026-10-24T00:00:00.000Z')",
      )
      .run(key(), outbox)
  }
  const data = new TextEncoder().encode('x'),
    digest = await crypto.subtle.digest('SHA-256', data)
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  const storage = {
    put: async () => ({ size: 1, checksums: { sha256: digest } }),
  } as unknown as R2Bucket
  const attachments = new CRMAttachments(fixture.db, storage, 1),
    link = { type: 'contact' as const, id: fixture.contact }
  for (const category of ['communications', 'finances']) {
    const id = String(
      (
        await attachments.stage({
          site: 'default',
          link,
          operationKey: key(),
          values: { filename: `Fictional ${category} file.txt`, size: 1, sha256, category },
        })
      ).id,
    )
    await attachments.upload({
      site: 'default',
      link,
      id,
      expectedRevision: 1,
      operationKey: key(),
      body: new ReadableStream({
        start(c) {
          c.enqueue(data)
          c.close()
        },
      }),
    })
  }
  await attachments.stage({
    site: 'default',
    link,
    operationKey: key(),
    values: {
      filename: 'Fictional unshared draft.txt',
      size: 1,
      sha256,
      category: 'communications',
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
    denied: [{ category: 'finances', operation: 'read' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  const reader = new ContactTimeline(fixture.db, 2)
  const letters = await reader.list({
    site: 'default',
    contact: fixture.contact,
    group: 'correspondence',
  })
  expect(letters.total).toBe(2)
  expect(letters.docs.every((row) => row.targetID === issued[0])).toBe(true)
  const files = await reader.list({
    site: 'default',
    contact: fixture.contact,
    group: 'attachments',
  })
  expect(files.total).toBe(2)
  expect(files.docs.every((row) => row.label === 'Fictional communications file.txt')).toBe(true)
  expect(
    (await timeline.list({ site: 'default', contact: fixture.contact, group: 'attachments' }))
      .total,
  ).toBe(5)
})

it('connects household, relationship, membership, opportunity and volunteer history under independent grants', async () => {
  const households = new HouseholdRepository(fixture.db, 1)
  const household = String(
    (
      await households.mutate({
        site: 'default',
        action: 'create-household',
        operationKey: key(),
        values: { name: 'Fictional timeline household', address: '' },
      })
    ).id,
  )
  await households.mutate({
    site: 'default',
    action: 'add-member',
    id: household,
    expectedRevision: 1,
    operationKey: key(),
    values: { constituent: fixture.contact, role: 'Member', startedOn: '2026-01-01' },
  })
  const other = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional related person' },
        roles: ['contact'],
        operationKey: key(),
      })
    ).id,
  )
  const relation = String(
    (
      await households.mutate({
        site: 'default',
        action: 'create-type',
        operationKey: key(),
        values: { label: 'Employer', reciprocalLabel: 'Employee' },
      })
    ).id,
  )
  await households.mutate({
    site: 'default',
    action: 'create-relationship',
    operationKey: key(),
    values: {
      source: fixture.contact,
      target: other,
      type: relation,
      startedOn: '2026-01-01',
      notes: '',
    },
  })
  const membership = new MembershipRepository(fixture.db, 1)
  const type = String(
    (
      await membership.saveType({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Fictional timeline membership',
          eligibility: 'person',
          termMonths: 12,
          minorUnits: '0',
          currency: 'USD',
          exponent: 2,
        },
      })
    ).id,
  )
  const term = String(
    (
      await membership.enroll({
        site: 'default',
        operationKey: key(),
        values: { type, typeRevision: 1, person: fixture.contact, startsOn: '2026-01-01' },
      })
    ).id,
  )
  await membership.cancel({
    site: 'default',
    id: term,
    expectedRevision: 1,
    effectiveOn: '2026-11-01',
    reason: 'Fictional cancellation',
    operationKey: key(),
  })
  const opportunities = new OpportunityRepository(fixture.db, 1)
  const pipeline = String(
    (
      await opportunities.savePipeline({
        site: 'default',
        operationKey: key(),
        values: { name: 'Fictional timeline pipeline' },
      })
    ).id,
  )
  const stages = (await opportunities.stages('default', pipeline)).docs
  await opportunities.save({
    site: 'default',
    operationKey: key(),
    values: {
      constituent: fixture.contact,
      name: 'Fictional timeline opportunity',
      pipeline,
      stage: stages[0].id,
      minorUnits: '1000',
      currency: 'USD',
      exponent: 2,
      owner: '',
      campaign: '',
      targetOn: '',
      nextAction: 'Call',
      nextOn: '2026-11-01',
      notes: '',
      reason: '',
      archived: false,
    },
  })
  const volunteers = new VolunteerRepository(fixture.db, 1)
  await volunteers.saveProfile({
    site: 'default',
    operationKey: key(),
    values: {
      constituent: fixture.contact,
      skills: ['Logistics'],
      interests: [],
      availability: 'Saturday',
      doNotContact: false,
      archived: false,
    },
  })
  const activity = String(
    (
      await volunteers.saveActivity({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Fictional timeline activity',
          description: '',
          location: '',
          startsOn: '2026-11-01',
          endsOn: '2026-11-03',
          skills: ['Logistics'],
          state: 'planned',
        },
      })
    ).id,
  )
  await volunteers.participate({
    site: 'default',
    operationKey: key(),
    values: {
      activity,
      activityRevision: 1,
      constituent: fixture.contact,
      state: 'attended',
      notes: '',
    },
  })
  const hours = String(
    (
      await volunteers.submitHours({
        site: 'default',
        operationKey: key(),
        values: { activity, constituent: fixture.contact, occurredOn: '2026-11-01', minutes: 90 },
      })
    ).id,
  )
  await volunteers.reviewHours({
    site: 'default',
    id: hours,
    expectedRevision: 1,
    operationKey: key(),
    values: { state: 'approved', reason: 'Fictional approval' },
  })
  const invitation = String(
    (
      await volunteers.invite({
        site: 'default',
        operationKey: key(),
        values: {
          activity,
          constituent: fixture.contact,
          channel: 'phone',
          occurredOn: '2026-10-24',
          notes: '',
          profileRevision: 1,
          activityRevision: 1,
        },
      })
    ).id,
  )
  await volunteers.respond({
    site: 'default',
    id: invitation,
    expectedRevision: 1,
    operationKey: key(),
    values: { response: 'declined', respondedOn: '2026-10-25', notes: '' },
  })
  const full = await timeline.list({ site: 'default', contact: fixture.contact })
  expect(full.docs.filter((row) => row.group === 'relationships')).toHaveLength(2)
  expect(full.docs.filter((row) => row.group === 'memberships')).toHaveLength(2)
  expect(full.docs.filter((row) => row.group === 'opportunities')).toHaveLength(2)
  expect(full.docs.filter((row) => row.group === 'volunteers')).toHaveLength(6)
  fixture.sqlite
    .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
    .run(other)
  expect(
    (await timeline.list({ site: 'default', contact: fixture.contact, group: 'relationships' }))
      .total,
  ).toBe(1)
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
    denied: [
      { category: 'memberships', operation: 'read' },
      { category: 'restricted-activity', operation: 'read' },
      { category: 'volunteer-hours', operation: 'read' },
    ],
    expectedRevision: revision(),
    operationKey: key(),
  })
  const limited = await new ContactTimeline(fixture.db, 2).list({
    site: 'default',
    contact: fixture.contact,
  })
  expect(
    limited.docs.some((row) => row.group === 'memberships' || row.group === 'opportunities'),
  ).toBe(false)
  expect(limited.docs.filter((row) => row.group === 'volunteers').map((row) => row.title)).toEqual([
    'Volunteer profile recorded',
  ])
})

it('discards a completed query snapshot when a category grant is revoked before returning it', async () => {
  await gift()
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
  const prepare = fixture.db.prepare.bind(fixture.db)
  vi.spyOn(fixture.db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (!sql.startsWith('WITH authorized AS')) return statement
    return {
      bind: (...values: unknown[]) => {
        const bound = statement.bind(...values)
        return {
          first: async () => {
            const result = await bound.first()
            await authority.setRestrictions({
              site: 'default',
              user: 2,
              denied: [{ category: 'finances', operation: 'read' }],
              expectedRevision: revision(),
              operationKey: key(),
            })
            return result
          },
        }
      },
    } as unknown as D1PreparedStatement
  })
  await expect(
    new ContactTimeline(fixture.db, 2).list({ site: 'default', contact: fixture.contact }),
  ).rejects.toThrow()
})
