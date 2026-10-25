import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { CommitmentRepository } from '../../src/crm/commitments'
import { FinanceRepository } from '../../src/crm/finance'
import { ContactRepository } from '../../src/crm/contacts'
import { OrganizationRepository } from '../../src/organizations/repository'
import { SiteConflictError } from '../../src/organizations/atomic'
import {
  givingDueOn,
  equalInstallments,
  effectiveGivingCredits,
} from '../../src/crm/commitment-model'

describe('pledges and recurring giving reconciliation', () => {
  const fixture = localD1(),
    db = fixture.db,
    key = () => crypto.randomUUID()
  let repo: CommitmentRepository,
    finance: FinanceRepository,
    contact: string,
    second: string,
    fund: string
  beforeAll(async () => {
    fixture.sqlite.exec(
      "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT); INSERT INTO users VALUES(1,'administrator','Manager'),(2,'editor','Other');",
    )
    for (const sql of [
      ...organizationSchema,
      ...defaultOrganizationSeed,
      ...contactSchemaV1,
      ...financeSchemaV1,
      ...fundraisingSchemaV1,
      ...commitmentSchemaV1,
    ])
      fixture.sqlite.exec(sql)
    repo = new CommitmentRepository(db, 1)
    finance = new FinanceRepository(db, 1)
    const contacts = new ContactRepository(db, 1)
    contact = (
      await contacts.create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional Giver' },
        roles: ['donor'],
        operationKey: key(),
      })
    ).id as string
    second = (
      await contacts.create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Other Giver' },
        roles: ['donor'],
        operationKey: key(),
      })
    ).id as string
    fund = (await finance.createFund({ site: 'default', name: 'General', operationKey: key() }))
      .id as string
  })
  afterAll(() => fixture.close())
  const terms = (kind: 'pledge' | 'recurring', amount = '1000') => ({
    kind,
    name: `Fictional ${kind}`,
    constituent: contact,
    currency: 'USD',
    exponent: 2,
    minorUnits: amount,
    startsOn: '2026-01-31',
    frequency: 'monthly',
    installments:
      kind === 'pledge' ? equalInstallments(amount, 'USD', '2026-01-31', 'monthly', 2) : [],
  })
  const gift = async (minorUnits: string, constituent = contact) => {
    const created = await finance.createGift({
      site: 'default',
      constituent,
      amount: { currency: 'USD', minorUnits },
      exponent: 2,
      kind: 'cash',
      receivedOn: '2026-02-01',
      allocations: [{ fund, currency: 'USD', minorUnits }],
      operationKey: key(),
    })
    return String(created.id)
  }
  it('anchors monthly/yearly dates and divides every minor unit exactly', () => {
    expect(givingDueOn('2026-01-31', 'monthly', 1)).toBe('2026-02-28')
    expect(givingDueOn('2026-01-31', 'monthly', 2)).toBe('2026-03-31')
    expect(givingDueOn('2024-02-29', 'annually', 1)).toBe('2025-02-28')
    expect(givingDueOn('2024-02-29', 'annually', 4)).toBe('2028-02-29')
    expect(
      equalInstallments('1001', 'USD', '2026-01-31', 'monthly', 3).map((i) => i.minorUnits),
    ).toEqual(['334', '334', '333'])
    expect([
      ...effectiveGivingCredits('1', [
        { id: 'b', minorUnits: '1' },
        { id: 'a', minorUnits: '1' },
      ]),
    ]).toEqual([
      ['a', '1'],
      ['b', '0'],
    ])
  })
  it('creates audited retry-safe pledges and rejects unbalanced installments atomically', async () => {
    const input = { site: 'default', operationKey: key(), values: terms('pledge') }
    const first = await repo.create(input)
    expect(await repo.create(input)).toEqual(first)
    const detail = await repo.get('default', first.id as string, '2026-01-31')
    expect(detail.summary).toMatchObject({
      expectedMinor: '1000',
      overdueMinor: '500',
      outstandingMinor: '1000',
      receivedMinor: '0',
    })
    expect(detail.installments).toHaveLength(2)
    const count = await db.prepare('SELECT count(*) n FROM vc_crm_commitments').first()
    await expect(
      repo.create({
        site: 'default',
        operationKey: key(),
        values: { ...terms('pledge'), installments: [{ dueOn: '2026-01-31', minorUnits: '1' }] },
      }),
    ).rejects.toThrow('must equal')
    expect(await db.prepare('SELECT count(*) n FROM vc_crm_commitments').first()).toEqual(count)
  })
  it('applies payments across pledges, prevents over-allocation, and reconciles refunds and reversals', async () => {
    const p1 = String(
        (await repo.create({ site: 'default', operationKey: key(), values: terms('pledge') })).id,
      ),
      p2 = String(
        (await repo.create({ site: 'default', operationKey: key(), values: terms('pledge') })).id,
      )
    const payment = await gift('1000'),
      d1 = await repo.get('default', p1, '2026-12-31'),
      d2 = await repo.get('default', p2, '2026-12-31')
    const apply = {
      site: 'default',
      id: p1,
      expectedRevision: 1,
      operationKey: key(),
      gift: payment,
      giftRevision: 1,
      installment: d1.installments[0].key,
      minorUnits: '600',
      reason: 'Apply recorded gift',
    }
    await repo.apply(apply)
    expect(await repo.apply(apply)).toEqual({ id: p1 })
    await expect(
      repo.apply({
        ...apply,
        id: p2,
        installment: d2.installments[0].key,
        expectedRevision: 1,
        giftRevision: 2,
        operationKey: key(),
        minorUnits: '401',
      }),
    ).rejects.toThrow('cannot exceed')
    await repo.apply({
      ...apply,
      id: p2,
      installment: d2.installments[0].key,
      expectedRevision: 1,
      giftRevision: 2,
      operationKey: key(),
      minorUnits: '400',
    })
    await finance.adjust({
      site: 'default',
      id: payment,
      expectedRevision: 3,
      action: 'refund',
      deltaMinor: '-500',
      reason: 'Refund half',
      operationKey: key(),
    })
    expect((await repo.get('default', p1, '2026-12-31')).summary.receivedMinor).toBe('300')
    expect((await repo.get('default', p2, '2026-12-31')).summary.receivedMinor).toBe('200')
    const detail = await repo.get('default', p1, '2026-12-31')
    await repo.apply({
      ...apply,
      expectedRevision: detail.doc.revision,
      giftRevision: 4,
      operationKey: key(),
      reverseApplication: detail.applications[0].id,
      reason: 'Correct pledge matching',
    })
    expect((await repo.get('default', p1, '2026-12-31')).summary.receivedMinor).toBe('0')
    expect((await repo.get('default', p2, '2026-12-31')).summary.receivedMinor).toBe('400')
    expect((await finance.get('default', payment)).netMinor).toBe('500')
    await finance.adjust({
      site: 'default',
      id: payment,
      expectedRevision: 5,
      action: 'void',
      deltaMinor: '0',
      reason: 'Void recorded payment',
      operationKey: key(),
    })
    expect((await repo.get('default', p2, '2026-12-31')).summary.receivedMinor).toBe('0')
  })
  it('preserves expected-vs-received history through pause, resume and cancellation', async () => {
    const id = String(
      (
        await repo.create({
          site: 'default',
          operationKey: key(),
          values: terms('recurring', '100'),
        })
      ).id,
    )
    expect((await repo.get('default', id, '2026-04-30')).summary.expectedMinor).toBe('400')
    await repo.change({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey: key(),
      action: 'pause',
      effectiveOn: '2026-02-01',
      reason: 'Temporary pause',
    })
    expect((await repo.get('default', id, '2026-04-30')).summary.expectedMinor).toBe('100')
    await repo.change({
      site: 'default',
      id,
      expectedRevision: 2,
      operationKey: key(),
      action: 'resume',
      effectiveOn: '2026-03-31',
      reason: 'Resume',
    })
    expect((await repo.get('default', id, '2026-04-30')).summary.expectedMinor).toBe('300')
    await repo.change({
      site: 'default',
      id,
      expectedRevision: 3,
      operationKey: key(),
      action: 'pause',
      effectiveOn: '2026-04-01',
      reason: 'Second pause',
    })
    expect((await repo.get('default', id, '2026-12-31')).summary.expectedMinor).toBe('200')
    await repo.change({
      site: 'default',
      id,
      expectedRevision: 4,
      operationKey: key(),
      action: 'resume',
      effectiveOn: '2026-05-31',
      reason: 'Second resume',
    })
    expect((await repo.get('default', id, '2026-05-31')).summary.expectedMinor).toBe('300')
    await repo.change({
      site: 'default',
      id,
      expectedRevision: 5,
      operationKey: key(),
      action: 'cancel',
      effectiveOn: '2026-05-31',
      reason: 'Stopped schedule',
    })
    expect((await repo.get('default', id, '2027-12-31')).summary.expectedMinor).toBe('300')
    expect((await repo.get('default', id, '2027-12-31', 5)).installments).toHaveLength(0)
  })
  it('rejects wrong donors, stale changes and unrelated roots with no financial mutations', async () => {
    const id = String(
        (await repo.create({ site: 'default', operationKey: key(), values: terms('recurring') }))
          .id,
      ),
      payment = await gift('1000', second)
    await expect(
      repo.apply({
        site: 'default',
        id,
        expectedRevision: 1,
        operationKey: key(),
        gift: payment,
        giftRevision: 1,
        installment: '0',
        minorUnits: '1000',
        reason: 'Invalid donor',
      }),
    ).rejects.toThrow()
    await repo.change({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey: key(),
      action: 'rename',
      effectiveOn: '2026-01-31',
      reason: 'Clarify name',
      name: 'Monthly support',
    })
    await expect(
      repo.change({
        site: 'default',
        id,
        expectedRevision: 1,
        operationKey: key(),
        action: 'cancel',
        effectiveOn: '2026-01-31',
        reason: 'Stale',
      }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    const other = await new OrganizationRepository(db, 1).createOrganization({
      name: 'Other root',
      siteName: 'Other site',
      operationKey: key(),
    })
    await expect(repo.get(other.site as string, id, '2026-12-31')).rejects.toThrow()
    expect((await finance.get('default', payment)).revision).toBe(1)
  })
  it('pages complete retained change history with tied timestamps and enforces current chapter/contact access', async () => {
    const record = await repo.create({
      site: 'default',
      operationKey: key(),
      values: terms('pledge'),
    })
    const id = String(record.id)
    const root = (await db
      .prepare('SELECT organization_id FROM vc_sites WHERE id=?')
      .bind('default')
      .first<{ organization_id: string }>())!.organization_id
    const insert = fixture.sqlite.prepare(
      'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,after_value,reason,operation_key,created_at) VALUES(?,?,?,1,?,?,?,?,?,?,?)',
    )
    for (let index = 0; index < 28; index++) {
      insert.run(
        `history-${String(index).padStart(3, '0')}`,
        root,
        'default',
        'giving.changed',
        'giving',
        id,
        JSON.stringify({
          action: 'rename',
          effectiveOn: '2026-01-31',
          name: `Recorded name ${index}`,
        }),
        `Retained explanation ${index}`,
        key(),
        '2027-01-01T00:00:00.000Z',
      )
    }
    insert.run(
      key(),
      root,
      'default',
      'giving.changed',
      'giving',
      'unrelated-record',
      '{}',
      'Private unrelated reason',
      key(),
      '2027-01-01T00:00:00.000Z',
    )
    const first = await repo.history('default', id)
    expect(first.docs).toHaveLength(25)
    expect(first.docs[0]).toMatchObject({
      reason: 'Retained explanation 27',
      actorLabel: 'Manager',
      change: 'rename',
      name: 'Recorded name 27',
    })
    const secondPage = await repo.history('default', id, first.next!)
    expect(secondPage.docs).toHaveLength(4)
    expect(secondPage.next).toBeNull()
    const all = [...first.docs, ...secondPage.docs]
    expect(new Set(all.map((event) => event.id)).size).toBe(29)
    expect(all.some((event) => event.reason === 'Private unrelated reason')).toBe(false)
    await expect(repo.history('default', id, { createdAt: 'invalid', id: 'x' })).rejects.toThrow()
    const restricted = new CommitmentRepository(db, 2)
    expect((await restricted.history('default', id)).docs.length).toBe(25)
    fixture.sqlite
      .prepare(
        'INSERT INTO vc_member_restrictions(site_id,user_id,category,operation) VALUES(?,2,?,?)',
      )
      .run('default', 'finances', 'read')
    await expect(restricted.history('default', id)).rejects.toThrow()
    const foreign = await new OrganizationRepository(db, 1).createOrganization({
      name: 'History foreign root',
      siteName: 'History foreign chapter',
      operationKey: key(),
    })
    await expect(repo.history(String(foreign.site), id)).rejects.toThrow()
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE site_id=? AND constituent_id=?')
      .run('default', contact)
    try {
      await expect(repo.history('default', id)).rejects.toThrow()
    } finally {
      fixture.sqlite
        .prepare('UPDATE vc_crm_affiliations SET archived=0 WHERE site_id=? AND constituent_id=?')
        .run('default', contact)
    }
  })
})
