import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { BookingStore, bookingSQL } from '@/forms/booking'
import { canForm, permittedSites } from '@/forms/access'
import { allowsOperation } from '@/content-framework/permission-value'
import { visibleAnswers, entrySchema } from '@/forms/redaction'
import { constantEqual, fileSignature, hashToken, randomToken, readBoundedJSON, safeFilename } from '@/forms/security'

function database() {
  const sqlite = new DatabaseSync(':memory:')
  for (const sql of bookingSQL) sqlite.exec(sql)
  const binding = { prepare(sql: string) {
    let values: (string | number)[] = []
    const statement = {
      bind(...next: (string | number)[]) { values = next; return statement },
      async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } } },
      async all() { return { results: sqlite.prepare(sql).all(...values) } },
      async first() { return sqlite.prepare(sql).get(...values) || null },
    }
    return statement
  } } as unknown as D1Database
  return { sqlite, binding }
}
describe('Forms security and site boundary', () => {
  it('removes private schema configuration from historical entry responses', () => {
    const fields = [{ id: 'secret', kind: 'text', label: 'Secret', sensitive: true, defaultValue: 'private-default', options: [{ id: 'one', value: 'one', label: 'private-choice' }] }]
    expect(entrySchema(fields, false)).toEqual([{ id: 'secret', kind: 'text', label: 'Secret', sensitive: true }])
    expect(JSON.stringify(entrySchema(fields, true))).not.toContain('private-default')
    expect(fields[0].defaultValue).toBe('private-default')
  })
  it('redacts sensitive nested answers using the historical schema without modifying the original', () => {
    const fields = [
      { id: 'public', kind: 'text', label: 'Public answer' },
      { id: 'private', kind: 'text', label: 'Private answer', sensitive: true },
      { id: 'people', kind: 'repeater', label: 'People', children: [{ id: 'name', kind: 'text', label: 'Name' }, { id: 'salary', kind: 'number', label: 'Salary', sensitive: true }] },
    ]
    const answers = { public: 'Hello', private: 'Secret', people: [{ name: 'Sample', salary: 42 }], unknown: 'Hidden' }
    expect(visibleAnswers(fields, answers, false)).toEqual({ public: 'Hello', people: [{ name: 'Sample' }] })
    expect(visibleAnswers(fields, answers, true).private).toBe('Secret')
    expect(answers.people[0].salary).toBe(42)
  })
  it('understands scoped Payload permission objects without treating queries as permission grants', () => {
    expect(allowsOperation(true)).toBe(true)
    expect(allowsOperation({ permission: true, where: { site: { equals: 'default' } } })).toBe(true)
    expect(allowsOperation({ permission: false, where: { site: { equals: 'default' } } })).toBe(false)
    expect(allowsOperation({ where: { site: { equals: 'default' } } })).toBe(false)
    expect(allowsOperation(undefined)).toBe(false)
  })
  it('uses explicit per-operation site grants', () => {
    expect(permittedSites(null, 'entries')).toEqual([])
    expect(canForm({ id: 1, role: 'editor' }, 'publish')).toBe(false)
    expect(canForm({ id: 1, role: 'administrator' }, 'entries', 'another-site')).toBe(false)
    expect(canForm({ id: 1, role: 'editor', formAccess: [{ site: 'team', permissions: ['export'] }] }, 'export', 'team')).toBe(true)
  })
  it('generates hashed, high entropy tokens and validates file signatures', async () => {
    const one = randomToken(), two = randomToken()
    expect(one).toHaveLength(64); expect(one).not.toBe(two)
    expect(await hashToken(one)).not.toBe(one)
    expect(constantEqual(one, one)).toBe(true); expect(constantEqual(one, two)).toBe(false)
    expect(fileSignature(new TextEncoder().encode('<script>'), 'application/pdf')).toBe(false)
    expect(fileSignature(new TextEncoder().encode('%PDF-1.7'), 'application/pdf')).toBe(true)
    expect(safeFilename('../../attack<script>.pdf')).not.toContain('/')
  })
  it('rejects prototype keys and oversized request bodies', async () => {
    const body = (text: string) => new Request('https://forms.example', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })
    await expect(readBoundedJSON(body('{"__proto__":{"admin":true}}'))).rejects.toThrow('Invalid property')
    await expect(readBoundedJSON(body('{"answer":"large"}'), 5)).rejects.toThrow('too large')
    await expect(readBoundedJSON(body('{"answer":"valid"}'))).resolves.toEqual({ answer: 'valid' })
  })
})
describe('Atomic booking allocation using the production SQL', () => {
  it('allows only one of two concurrent requests for the last place', async () => {
    const { sqlite, binding } = database(), store = new BookingStore(binding)
    await store.defineSlot({ id: 'slot', site: 'default', resource: 'room', startsAt: '2026-11-01T06:30:00Z', endsAt: '2026-11-01T07:30:00Z', capacity: 1 })
    const result = await Promise.allSettled([store.hold('default', 'slot', 'a'), store.hold('default', 'slot', 'b')])
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM form_booking_holds').get()?.count).toBe(1)
    sqlite.close()
  })
  it('releases expired holds, enforces ownership and isolates sites', async () => {
    const { sqlite, binding } = database(), store = new BookingStore(binding), now = Date.now()
    await store.defineSlot({ id: 'slot', site: 'default', resource: 'room', startsAt: '2026-11-01T06:30:00Z', endsAt: '2026-11-01T07:30:00Z', capacity: 1 })
    const hold = await store.hold('default', 'slot', 'owner', 1, 1, now)
    await store.release('default', hold.token, 'stranger')
    await expect(store.hold('default', 'slot', 'other', 1, 1, now)).rejects.toThrow('no longer')
    await expect(store.hold('other-site', 'slot', 'owner', 1, 1, now + 120000)).rejects.toThrow('no longer')
    const next = await store.hold('default', 'slot', 'other', 1, 1, now + 120000)
    await store.release('default', next.token, 'other')
    await expect(store.hold('default', 'slot', 'third', 1, 1, now + 120000)).resolves.toBeDefined()
    sqlite.close()
  })
})
