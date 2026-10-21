import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { FinanceRepository, calendarDate } from '../../src/crm/finance'
import { ContactRepository } from '../../src/crm/contacts'
import { OrganizationRepository, SiteAccessError } from '../../src/organizations/repository'
import { SiteConflictError } from '../../src/organizations/atomic'

describe('private chapter financial workflow on actual local D1', () => {
  let proxy: PlatformProxy<{ D1: D1Database }>,
    db: D1Database,
    finance: FinanceRepository,
    contact: string,
    fund: string
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
      .prepare(
        "INSERT INTO users VALUES(1,'administrator','Fictional Manager'),(2,'editor','Fictional Reader'),(3,'editor','Other organization')",
      )
      .run()
    for (const statement of [
      ...organizationSchema,
      ...defaultOrganizationSeed,
      ...contactSchemaV1,
      ...financeSchemaV1,
    ])
      await db.prepare(statement).run()
    finance = new FinanceRepository(db, 1)
    contact = (
      await new ContactRepository(db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional Donor' },
        roles: ['donor'],
        operationKey: 'finance_contact_12345678',
      })
    ).id as string
    fund = (
      await finance.createFund({
        site: 'default',
        name: 'Fictional General Fund',
        operationKey: 'finance_fund_123456789',
      })
    ).id as string
  })
  afterAll(async () => {
    await proxy?.dispose()
  })
  const input = (operationKey: string, minorUnits = '12500') => ({
    site: 'default',
    constituent: contact,
    amount: { currency: 'USD', minorUnits },
    exponent: 2,
    kind: 'cash' as const,
    receivedOn: '2026-10-20',
    allocations: [{ currency: 'USD', minorUnits, fund }],
    operationKey,
  })
  it('validates calendar dates independently of timezone', () => {
    expect(calendarDate('2024-02-29')).toBe('2024-02-29')
    expect(() => calendarDate('2026-02-29')).toThrow('valid calendar')
    expect(() => calendarDate('2026-10-20T12:00:00Z')).toThrow('valid calendar')
  })
  it('records exact large gifts with allocations and retry-safe atomic audits', async () => {
    const mutation = input('gift_create_large_123456', '900719925474099399')
    const first = await finance.createGift(mutation)
    expect(await finance.createGift(mutation)).toEqual(first)
    const gift = await finance.get('default', first.id as string)
    expect(gift.originalMinor).toBe('900719925474099399')
    expect(gift.netMinor).toBe(gift.originalMinor)
    expect(gift.allocations[0].fund).toBe(fund)
    expect(
      (
        await db
          .prepare('SELECT count(*) AS n FROM vc_platform_audit WHERE record_id=?')
          .bind(first.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1)
    await expect(
      finance.createGift({ ...mutation, reference: 'Changed intent' }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    await expect(
      db.prepare("UPDATE vc_crm_gifts SET original_minor='100' WHERE id=?").bind(first.id).run(),
    ).rejects.toThrow('immutable')
    await expect(
      db.prepare('DELETE FROM vc_crm_gifts WHERE id=?').bind(first.id).run(),
    ).rejects.toThrow('retained')
  })
  it('retains original gifts and records refunds, corrections and voids with stale-update protection', async () => {
    const gift = await finance.createGift(input('gift_adjust_seed_1234567'))
    const refund = {
      site: 'default',
      id: gift.id as string,
      action: 'refund' as const,
      deltaMinor: '-2500',
      reason: 'Fictional partial refund',
      expectedRevision: 1,
      operationKey: 'gift_refund_1234567890',
    }
    expect(await finance.adjust(refund)).toEqual(await finance.adjust(refund))
    let detail = await finance.get('default', gift.id as string)
    expect(detail.originalMinor).toBe('12500')
    expect(detail.netMinor).toBe('10000')
    expect(detail.adjustmentTotal).toBe(1)
    await expect(
      finance.adjust({ ...refund, operationKey: 'gift_stale_refund_12345' }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    await expect(
      finance.adjust({
        ...refund,
        expectedRevision: 2,
        deltaMinor: '-10001',
        operationKey: 'gift_overrefund_1234567',
      }),
    ).rejects.toThrow('nonnegative')
    await finance.adjust({
      ...refund,
      expectedRevision: 2,
      action: 'correction',
      deltaMinor: '500',
      reason: 'Fictional correction',
      operationKey: 'gift_correction_1234567',
    })
    const voidInput = {
      ...refund,
      expectedRevision: 3,
      action: 'void' as const,
      deltaMinor: '0',
      reason: 'Fictional void',
      operationKey: 'gift_void_12345678901',
    }
    expect(await finance.adjust(voidInput)).toEqual(await finance.adjust(voidInput))
    detail = await finance.get('default', gift.id as string)
    expect(detail.state).toBe('void')
    expect(detail.adjustmentTotal).toBe(3)
    await expect(
      db.prepare('DELETE FROM vc_crm_gift_adjustments WHERE gift_id=?').bind(gift.id).run(),
    ).rejects.toThrow('append-only')
    await expect(
      db
        .prepare("UPDATE vc_crm_gift_adjustments SET reason='tampered' WHERE gift_id=?")
        .bind(gift.id)
        .run(),
    ).rejects.toThrow('append-only')
    expect(
      (
        await db
          .prepare('SELECT count(*) AS n FROM vc_platform_audit WHERE record_id=?')
          .bind(gift.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(4)
  })
  it('uses full matching counts and paginates without mixing in-kind estimates', async () => {
    await finance.createGift({ ...input('gift_inkind_1234567890'), kind: 'in-kind' })
    const first = await finance.list({ site: 'default', constituent: contact, limit: 1 })
    const second = await finance.list({ site: 'default', constituent: contact, limit: 1, page: 2 })
    expect(first.total).toBe(3)
    expect(second.total).toBe(3)
    expect(first.docs[0].id).not.toBe(second.docs[0].id)
    const all = await finance.list({ site: 'default' })
    expect(all.docs.some((gift) => gift.kind === 'in-kind')).toBe(true)
    expect(all.docs.some((gift) => gift.state === 'void')).toBe(true)
  })
  it('enforces independent finance access and prevents cross-root references', async () => {
    const reader = new FinanceRepository(db, 2)
    expect((await reader.list({ site: 'default' })).canEdit).toBe(false)
    await expect(reader.createGift(input('reader_gift_denied_1234'))).rejects.toBeInstanceOf(
      SiteAccessError,
    )
    const admin = new OrganizationRepository(db, 1)
    const other = await admin.createOrganization({
      name: 'Other nonprofit',
      siteName: 'Other chapter',
      operationKey: 'finance_other_root_12345',
    })
    await expect(
      finance.createGift({ ...input('gift_cross_root_1234567'), site: other.site as string }),
    ).rejects.toBeInstanceOf(SiteAccessError)
    await admin.setRestrictions({
      site: 'default',
      user: 2,
      denied: [{ category: 'finances', operation: 'read' }],
      expectedRevision: 1,
      operationKey: 'finance_deny_reader_1234',
    })
    expect((await new ContactRepository(db, 2).get('default', contact)).id).toBe(contact)
    await expect(reader.list({ site: 'default' })).rejects.toBeInstanceOf(SiteAccessError)
    await expect(
      reader.get('default', (await finance.list({ site: 'default' })).docs[0].id),
    ).rejects.toBeInstanceOf(SiteAccessError)
  })
  it('rejects unbalanced allocations, cross-chapter funds and currency precision changes', async () => {
    await expect(
      finance.createGift({
        ...input('gift_unbalanced_1234567'),
        allocations: [{ currency: 'USD', minorUnits: '1', fund }],
      }),
    ).rejects.toThrow('equal')
    await expect(
      finance.createGift({ ...input('gift_precision_12345678'), exponent: 0 }),
    ).rejects.toThrow('precision')
    const root = await new OrganizationRepository(db, 1).createOrganization({
      name: 'Restricted fund owner',
      siteName: 'Restricted',
      operationKey: 'fund_other_root_1234567',
    })
    const other = await finance.createFund({
      site: root.site as string,
      name: 'Private fund',
      operationKey: 'fund_other_create_123456',
    })
    await expect(
      finance.createGift({
        ...input('gift_foreign_fund_12345'),
        allocations: [{ currency: 'USD', minorUnits: '12500', fund: other.id as string }],
      }),
    ).rejects.toBeInstanceOf(SiteAccessError)
  })
  it('keeps split-fund corrections balanced and never makes a fund negative', async () => {
    const second = await finance.createFund({
      site: 'default',
      name: 'Fictional Restricted Fund',
      operationKey: 'split_second_fund_123456',
    })
    const gift = await finance.createGift({
      ...input('split_gift_12345678901', '10000'),
      allocations: [
        { currency: 'USD', minorUnits: '6000', fund },
        { currency: 'USD', minorUnits: '4000', fund: second.id as string },
      ],
    })
    const adjustment = {
      site: 'default',
      id: gift.id as string,
      action: 'refund' as const,
      deltaMinor: '-3000',
      reason: 'Fictional restricted-fund refund',
      expectedRevision: 1,
      operationKey: 'split_refund_123456789',
    }
    await expect(finance.adjust(adjustment)).rejects.toThrow('allocation changes')
    await expect(
      finance.adjust({
        ...adjustment,
        allocations: [{ currency: 'USD', minorUnits: '-3001', fund }],
      }),
    ).rejects.toThrow('equal')
    await expect(
      finance.adjust({
        ...adjustment,
        deltaMinor: '-5000',
        allocations: [{ currency: 'USD', minorUnits: '-5000', fund: second.id as string }],
      }),
    ).rejects.toThrow('nonnegative')
    await finance.adjust({
      ...adjustment,
      allocations: [{ currency: 'USD', minorUnits: '-3000', fund: second.id as string }],
    })
    const current = await finance.get('default', gift.id as string)
    expect(current.netMinor).toBe('7000')
    expect(current.netAllocations.map((item) => item.minorUnits)).toEqual(['6000', '1000'])
    expect(current.allocations.map((item) => item.minorUnits)).toEqual(['6000', '4000'])
  })
})
