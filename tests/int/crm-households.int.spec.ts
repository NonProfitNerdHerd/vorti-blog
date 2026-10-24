import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { householdSchemaV1 } from '../../src/crm/household-schema-v1'
import { HouseholdRepository } from '../../src/crm/households'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
import { SiteConflictError } from '../../src/organizations/atomic'
import { OrganizationRepository } from '../../src/organizations/repository'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { FundraisingRepository } from '../../src/crm/fundraising'
import { activitySchemaV1 } from '../../src/crm/activity-schema-v1'
import { ActivityRepository } from '../../src/crm/activities'
import { crmJobSchemaV1 } from '../../src/crm/job-schema-v1'
import { CRMJobs } from '../../src/crm/jobs'

describe('chapter households and reciprocal relationships on actual D1', () => {
  let proxy: PlatformProxy<{ D1: D1Database }>, db: D1Database, repo: HouseholdRepository
  let alex: string, pat: string, household: string, type: string, otherSite: string, foreign: string
  const key = () => crypto.randomUUID()
  beforeAll(async () => {
    proxy = await getPlatformProxy<{ D1: D1Database }>({
      configPath: 'tests/fixtures/organization-worker/wrangler.jsonc',
      persist: false,
      remoteBindings: false,
    })
    db = proxy.env.D1
    await db
      .prepare('CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT)')
      .run()
    await db
      .prepare("INSERT INTO users VALUES(1,'administrator','Manager'),(2,'editor','Reader')")
      .run()
    for (const sql of [
      ...organizationSchema,
      ...defaultOrganizationSeed,
      ...contactSchemaV1,
      ...financeSchemaV1,
      ...householdSchemaV1,
      ...fundraisingSchemaV1,
      ...activitySchemaV1,
      ...crmJobSchemaV1,
    ])
      await db.prepare(sql).run()
    await db.prepare('CREATE TABLE crm_test_effects(id TEXT PRIMARY KEY)').run()
    repo = new HouseholdRepository(db, 1)
    const contacts = new ContactRepository(db, 1)
    alex = (
      await contacts.create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Alex' },
        roles: ['donor'],
        operationKey: key(),
      })
    ).id as string
    pat = (
      await contacts.create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Pat' },
        roles: ['donor'],
        operationKey: key(),
      })
    ).id as string
    otherSite = (
      await new OrganizationRepository(db, 1).createOrganization({
        name: 'Other Network',
        siteName: 'Other chapter',
        operationKey: key(),
      })
    ).site as string
    foreign = (
      await contacts.create({
        site: otherSite,
        profile: { kind: 'person', firstName: 'Hidden' },
        roles: ['donor'],
        operationKey: key(),
      })
    ).id as string
  })
  afterAll(async () => {
    await proxy?.dispose()
  })
  it('creates once on retry and retains dated members without changing identities', async () => {
    const input = {
      site: 'default',
      action: 'create-household',
      operationKey: key(),
      values: {
        name: 'Example household',
        address: '123 Fictional St',
        primaryContact: alex,
        startedOn: '2026-01-01',
      },
    }
    const first = await repo.mutate(input)
    expect(await repo.mutate(input)).toEqual(first)
    household = first.id as string
    const detail = await repo.get('default', household)
    expect(detail.members).toHaveLength(1)
    expect(detail.doc.primary_contact).toBe(alex)
    expect((await repo.list('default')).docs).toHaveLength(1)
    await repo.mutate({
      site: 'default',
      action: 'add-member',
      id: household,
      expectedRevision: 1,
      operationKey: key(),
      values: { constituent: pat, startedOn: '2026-03-01', role: 'Partner' },
    })
    expect((await repo.get('default', household)).members).toHaveLength(2)
  })
  it('rejects stale writes with no orphan audit and rejects foreign members', async () => {
    const before = await db
      .prepare('SELECT count(*) n FROM vc_platform_audit')
      .first<{ n: number }>()
    await expect(
      repo.mutate({
        site: 'default',
        action: 'update-household',
        id: household,
        expectedRevision: 1,
        operationKey: key(),
        values: { name: 'Stale' },
      }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    await expect(
      repo.mutate({
        site: 'default',
        action: 'add-member',
        id: household,
        expectedRevision: 2,
        operationKey: key(),
        values: { constituent: foreign, startedOn: '2026-01-01' },
      }),
    ).rejects.toThrow()
    expect(await db.prepare('SELECT count(*) n FROM vc_platform_audit').first()).toEqual(before)
    await expect(new HouseholdRepository(db, 2).get(otherSite, household)).rejects.toThrow()
    await expect(repo.get(otherSite, household)).rejects.toThrow()
  })
  it('shows reciprocal labels and preserves archived types on historical relationships', async () => {
    type = (
      await repo.mutate({
        site: 'default',
        action: 'create-type',
        operationKey: key(),
        values: { label: 'Employer', reciprocalLabel: 'Employee' },
      })
    ).id as string
    const relationship = await repo.mutate({
      site: 'default',
      action: 'create-relationship',
      operationKey: key(),
      values: {
        source: alex,
        target: pat,
        type,
        startedOn: '2026-01-01',
        notes: 'Fictional example',
      },
    })
    expect((await repo.relationships('default', alex)).docs[0].label).toBe('Employer')
    expect((await repo.relationships('default', pat)).docs[0].label).toBe('Employee')
    await repo.mutate({
      site: 'default',
      action: 'update-relationship',
      id: relationship.id as string,
      expectedRevision: 1,
      operationKey: key(),
      values: { startedOn: '2026-01-01', endedOn: '2026-04-01', notes: 'Ended' },
    })
    await repo.mutate({
      site: 'default',
      action: 'update-type',
      id: type,
      expectedRevision: 1,
      operationKey: key(),
      values: { label: 'Employer', reciprocalLabel: 'Employee', archived: true },
    })
    expect((await repo.relationships('default', alex)).docs[0].ended_on).toBe('2026-04-01')
    await expect(
      repo.mutate({
        site: 'default',
        action: 'create-relationship',
        operationKey: key(),
        values: { source: alex, target: pat, type, startedOn: '2026-01-01' },
      }),
    ).rejects.toThrow()
  })
  it('calculates exact net giving only within membership dates, excluding in-kind and duplicate membership periods', async () => {
    const finance = new FinanceRepository(db, 1)
    const fund = (
      await finance.createFund({ site: 'default', name: 'General', operationKey: key() })
    ).id as string
    const gift = async (constituent: string, date: string, amount: string) =>
      finance.createGift({
        site: 'default',
        constituent,
        amount: { currency: 'USD', minorUnits: amount },
        exponent: 2,
        kind: 'cash',
        receivedOn: date,
        allocations: [{ currency: 'USD', minorUnits: amount, fund }],
        operationKey: key(),
      })
    await gift(alex, '2025-12-31', '999')
    await gift(alex, '2026-01-01', '900719925474099399')
    await gift(pat, '2026-02-01', '999')
    await gift(pat, '2026-03-01', '101')
    expect((await repo.giving('default', household)).totals).toEqual([
      { currency: 'USD', exponent: 2, minorUnits: '900719925474099500', count: 2 },
    ])
    const detail = await repo.get('default', household)
    await repo.mutate({
      site: 'default',
      action: 'end-member',
      id: household,
      expectedRevision: detail.doc.revision,
      operationKey: key(),
      values: {
        member: detail.members.find((m) => m.constituent_id === alex)!.id,
        endedOn: '2026-01-31',
      },
    })
    expect((await repo.get('default', household)).doc.primary_contact).toBeNull()
    await gift(alex, '2026-02-01', '200')
    expect((await repo.giving('default', household)).totals[0].minorUnits).toBe(
      '900719925474099500',
    )
  }, 90000)
  it('revoking an affiliation hides its reciprocal identity and household member', async () => {
    await db
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE site_id=? AND constituent_id=?')
      .bind('default', pat)
      .run()
    expect((await repo.relationships('default', alex)).docs).toHaveLength(0)
    expect(
      (await repo.get('default', household)).members.some((m) => m.constituent_id === pat),
    ).toBe(false)
    await expect(
      repo.mutate({
        site: 'default',
        action: 'add-member',
        id: household,
        expectedRevision: 3,
        operationKey: key(),
        values: { constituent: pat, startedOn: '2026-03-01' },
      }),
    ).rejects.toThrow()
  })
  it('maintains campaign, fund and appeal records with revision conflicts and historical attribution', async () => {
    const fundraising = new FundraisingRepository(db, 1),
      finance = new FinanceRepository(db, 1)
    const fund = (
      await fundraising.save({
        site: 'default',
        kind: 'funds',
        operationKey: key(),
        values: { name: 'Education', description: 'Restricted education fund' },
      })
    ).id as string
    const campaignInput = {
      site: 'default',
      kind: 'campaigns' as const,
      operationKey: key(),
      values: {
        name: 'Annual drive',
        currency: 'USD',
        exponent: 2,
        goalMinor: '100000',
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
      },
    }
    const campaign = (await fundraising.save(campaignInput)).id as string
    expect((await fundraising.save(campaignInput)).id).toBe(campaign)
    const appeal = (
      await fundraising.save({
        site: 'default',
        kind: 'appeals',
        operationKey: key(),
        values: { name: 'Fall letter' },
      })
    ).id as string
    const gift = await finance.createGift({
      site: 'default',
      constituent: alex,
      amount: { currency: 'USD', minorUnits: '100' },
      exponent: 2,
      kind: 'cash',
      receivedOn: '2026-10-24',
      allocations: [{ fund, currency: 'USD', minorUnits: '100' }],
      campaign,
      appeal,
      operationKey: key(),
    })
    expect((await fundraising.linkedGifts('default', 'campaigns', campaign)).docs).toHaveLength(1)
    await fundraising.save({
      ...campaignInput,
      id: campaign,
      expectedRevision: 1,
      operationKey: key(),
      values: { ...campaignInput.values, archived: true },
    })
    expect((await fundraising.linkedGifts('default', 'campaigns', campaign)).docs[0].id).toBe(
      gift.id,
    )
    await expect(
      fundraising.save({
        ...campaignInput,
        id: campaign,
        expectedRevision: 1,
        operationKey: key(),
      }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    await expect(new FundraisingRepository(db, 2).list(otherSite, 'campaigns')).rejects.toThrow()
  })
  it('rejects foreign/archived gift classifications atomically without retaining the gift or audit', async () => {
    const fundraising = new FundraisingRepository(db, 1),
      finance = new FinanceRepository(db, 1)
    const foreignCampaign = (
      await fundraising.save({
        site: otherSite,
        kind: 'campaigns',
        operationKey: key(),
        values: { name: 'Private foreign campaign' },
      })
    ).id as string
    const fund = (await finance.funds('default')).docs[0].id
    const count = await db.prepare('SELECT count(*) n FROM vc_crm_gifts').first()
    const operationKey = key()
    await expect(
      finance.createGift({
        site: 'default',
        constituent: alex,
        amount: { currency: 'USD', minorUnits: '100' },
        exponent: 2,
        kind: 'cash',
        receivedOn: '2026-10-24',
        allocations: [{ fund, currency: 'USD', minorUnits: '100' }],
        campaign: foreignCampaign,
        operationKey,
      }),
    ).rejects.toThrow()
    expect(await db.prepare('SELECT count(*) n FROM vc_crm_gifts').first()).toEqual(count)
    expect(
      await db
        .prepare('SELECT id FROM vc_platform_audit WHERE operation_key=?')
        .bind(operationKey)
        .first(),
    ).toBeNull()
    expect(
      await db
        .prepare('SELECT operation_key FROM vc_platform_operations WHERE operation_key=?')
        .bind(operationKey)
        .first(),
    ).toBeNull()
  })
  it('records chapter communications with retry safety and retained edit history', async () => {
    const activities = new ActivityRepository(db, 1)
    const input = {
      site: 'default',
      contact: alex,
      operationKey: key(),
      values: {
        kind: 'phone',
        subject: 'Follow-up call',
        body: 'Fictional call notes',
        occurredOn: '2026-10-24',
      },
    }
    const first = await activities.save(input)
    expect(await activities.save(input)).toEqual(first)
    const updated = {
      ...input,
      id: first.id as string,
      expectedRevision: 1,
      operationKey: key(),
      values: { ...input.values, body: 'Corrected call notes', archived: true },
    }
    await activities.save(updated)
    expect((await activities.list('default', alex)).docs[0].archived).toBe(1)
    await expect(activities.save({ ...updated, operationKey: key() })).rejects.toBeInstanceOf(
      SiteConflictError,
    )
    const audit = await db
      .prepare(
        'SELECT before_value,after_value FROM vc_platform_audit WHERE record_id=? AND action=?',
      )
      .bind(first.id, 'activity.updated')
      .first<{ before_value: string; after_value: string }>()
    expect(JSON.parse(audit!.before_value).body).toBe('Fictional call notes')
    expect(JSON.parse(audit!.after_value).body).toBe('Corrected call notes')
    await expect(activities.list(otherSite, alex)).rejects.toThrow()
    await expect(
      activities.save({ ...input, contact: foreign, operationKey: key() }),
    ).rejects.toThrow()
    await expect(
      db.prepare('DELETE FROM vc_crm_activities WHERE id=?').bind(first.id).run(),
    ).rejects.toThrow('history is retained')
  })
  it('runs leased CRM jobs with an atomic resumable cursor and cancellation fencing', async () => {
    let now = Date.now()
    const jobs = new CRMJobs(db, () => now)
    const queued = {
      site: 'default',
      actor: 1,
      kind: 'report-export' as const,
      payload: { fictional: true },
      operationKey: key(),
    }
    const job = await jobs.enqueue(queued)
    expect(await jobs.enqueue(queued)).toEqual(job)
    const handler = {
      prepare: async (current: { cursor: string }) => ({
        writes: [
          db.prepare('INSERT INTO crm_test_effects(id) VALUES(?)').bind(current.cursor || 'first'),
        ],
        cursor: current.cursor ? 'finished' : 'second',
        processed: 1,
        done: !!current.cursor,
      }),
    }
    expect(await jobs.tick({ 'report-export': handler })).toBe(true)
    expect(await jobs.tick({ 'report-export': handler })).toBe(true)
    expect(await jobs.tick({ 'report-export': handler })).toBe(false)
    expect(
      await db
        .prepare('SELECT status,progress,fence FROM vc_crm_jobs WHERE id=?')
        .bind(job.id)
        .first(),
    ).toEqual({ status: 'completed', progress: 2, fence: 2 })
    const cancelled = await jobs.enqueue({ ...queued, operationKey: key() })
    let abandoned = false
    await jobs.tick({
      'report-export': {
        prepare: async () => {
          await jobs.cancel(1, 'default', cancelled.id as string, key())
          return {
            writes: [db.prepare("INSERT INTO crm_test_effects(id) VALUES('must-not-commit')")],
            cursor: 'done',
            processed: 1,
            done: true,
            abandon: async () => {
              abandoned = true
            },
          }
        },
      },
    })
    expect(abandoned).toBe(true)
    expect(
      await db.prepare("SELECT id FROM crm_test_effects WHERE id='must-not-commit'").first(),
    ).toBeNull()
    expect(
      (await db
        .prepare('SELECT status FROM vc_crm_jobs WHERE id=?')
        .bind(cancelled.id)
        .first<{ status: string }>())!.status,
    ).toBe('cancelled')
    now += 200000
  })
})
