import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { DatabaseSync } from 'node:sqlite'
import { statements } from '@/migrations/20261012_200651_forms_module'
import { acceptSubmission, type Acceptance } from '@/forms/acceptance'
import { ActionHandlers, FormOutbox, UnconfiguredAction } from '@/forms/outbox'
import { BookingStore, bookingSQL } from '@/forms/booking'
import { hashToken, hmac } from '@/forms/security'
import { analyticsEvent, recordAnalytics } from '@/forms/analytics'
import { maintainForms, scanUpload } from '@/forms/maintenance'
import type { FormPlatform } from '@/forms/platform'
import { emptyDefinition } from '@design-system/payload-design-core/forms'
import { paymentSQL } from '@/forms/payments'
import { applyPaymentEvent, paymentToken, verifyPaymentToken, type PaymentRow } from '@/forms/payment-store'
import { formPaymentEndpoints, paymentView } from '@/forms/payment-runtime'

function database() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('CREATE TABLE users (id integer PRIMARY KEY); CREATE TABLE forms (id integer PRIMARY KEY); INSERT INTO forms VALUES (1); CREATE TABLE form_submissions (id integer PRIMARY KEY, form_id integer, created_at text, updated_at text)')
  for (const sql of statements.filter(sql => /^ALTER TABLE (?:`?form_submissions`?)/.test(sql) || /^CREATE TABLE `form_(?:outbox|attachments|resources|analytics|drafts|exports)`/.test(sql) || /^CREATE (?:UNIQUE )?INDEX .* ON `form_(?:outbox|attachments|submissions|resources|analytics|drafts|exports)`/.test(sql))) sqlite.exec(sql)
  for (const sql of bookingSQL) sqlite.exec(sql)
  for (const sql of paymentSQL) sqlite.exec(sql)
  type Values = (string | number | null)[]
  function prepare(sql: string) {
    let values: Values = []
    const statement = {
      bind(...next: Values) { values = next; return statement },
      execute() { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } } },
      async run() { return statement.execute() },
      async first() { return sqlite.prepare(sql).get(...values) || null },
      async all() { return { results: sqlite.prepare(sql).all(...values) } },
    }
    return statement
  }
  const binding = { prepare, async batch(batch: ReturnType<typeof prepare>[]) {
    sqlite.exec('BEGIN')
    try { const results = batch.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results } catch (e) { sqlite.exec('ROLLBACK'); throw e }
  } } as unknown as D1Database
  return { sqlite, binding }
}
const input = (): Acceptance => ({ formID: 1, site: 'default', revision: 'revision', key: 'retry-key', sessionHash: 'session', answers: { text: 'Answer' }, snapshot: { title: 'Test', fields: [] }, actions: [{ id: 'email', kind: 'email', name: 'Email', config: {} }], payment: false, attachments: [] })

describe('Durable form acceptance', () => {
  it('accepts raw signed test webhooks once and never trusts an event from a different payment intent', async () => {
    const { sqlite, binding } = database()
    try {
      await acceptSubmission(binding, { ...input(), payment: true, paymentDetails: { provider: 'stripe', amount: 2500, currency: 'USD' }, actions: [{ ...input().actions[0], requiresPayment: true }] })
      sqlite.prepare("UPDATE form_payment_sessions SET checkout_ref='cs_test_one'").run()
      vi.stubEnv('STRIPE_TEST_SECRET_KEY', 'sk_test_local'); vi.stubEnv('STRIPE_TEST_WEBHOOK_SECRET', 'whsec_local')
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ id: 'cs_test_one', livemode: false, amount_total: 2500, currency: 'usd', metadata: { submissionKey: 'retry-key' }, payment_status: 'paid', payment_intent: { id: 'pi_one', status: 'succeeded', latest_charge: { amount: 2500, amount_refunded: 0, refunded: false } } })))
      const endpoint = formPaymentEndpoints({ db: binding, local: true } as FormPlatform).find(item => item.path === '/forms-payment-webhook')!
      const created = Math.floor(Date.now() / 1000)
      const request = async (intent: string, tamper = false) => {
        const raw = JSON.stringify({ id: `evt_${intent}`, type: 'payment_intent.succeeded', created, livemode: false, data: { object: { id: intent, metadata: { submissionKey: 'retry-key' } } } })
        const signature = await hmac('whsec_local', `${created}.${raw}`)
        return Object.assign(new Request('http://localhost/api/forms-payment-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${created},v1=${signature}` }, body: raw + (tamper ? ' ' : '') }), { payload: {} }) as unknown as PayloadRequest
      }
      expect((await endpoint.handler(await request('pi_one', true))).status).toBe(400)
      expect((await endpoint.handler(await request('pi_other'))).status).toBe(400)
      expect(sqlite.prepare('SELECT payment_status FROM form_submissions').get()?.payment_status).toBe('pending')
      expect((await endpoint.handler(await request('pi_one'))).status).toBe(200)
      expect((await endpoint.handler(await request('pi_one'))).status).toBe(200)
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM form_payment_events').get()?.n).toBe(1)
      expect(sqlite.prepare('SELECT status FROM form_outbox').get()?.status).toBe('pending')
      expect(sqlite.prepare('SELECT payment_status FROM form_submissions').get()?.payment_status).toBe('paid')
    } finally { sqlite.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs() }
  })
  it('recovers delayed Stripe events from the stored checkout and throttles repeated public refreshes', async () => {
    const { sqlite, binding } = database()
    try {
      await acceptSubmission(binding, { ...input(), payment: true, paymentDetails: { provider: 'stripe', amount: 2500, currency: 'USD' } })
      sqlite.prepare("UPDATE form_payment_sessions SET checkout_ref='cs_test_one',updated_at='2020-01-01'").run()
      const row = sqlite.prepare('SELECT * FROM form_payment_sessions').get() as unknown as PaymentRow
      const token = await paymentToken('secret', row), platform = { db: binding, local: true } as FormPlatform
      const endpoint = formPaymentEndpoints(platform).find(item => item.path === '/forms-payments/:key')!
      vi.stubEnv('STRIPE_TEST_SECRET_KEY', 'sk_test_local'); vi.stubEnv('STRIPE_TEST_WEBHOOK_SECRET', 'whsec_local')
      const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'cs_test_one', livemode: false, amount_total: 2500, currency: 'usd', metadata: { submissionKey: row.submission_key }, payment_status: 'paid', payment_intent: { id: 'pi_one', status: 'succeeded', latest_charge: { amount: 2500, amount_refunded: 0, refunded: false } } }))
      vi.stubGlobal('fetch', fetcher)
      const request = (authorization: string) => Object.assign(new Request(`http://localhost/api/forms-payments/${row.submission_key}`, { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'X-Form-Payment': authorization }, body: JSON.stringify({ operation: 'status' }) }), { routeParams: { key: row.submission_key }, payload: { secret: 'secret' } }) as unknown as PayloadRequest
      expect((await endpoint.handler(request('forged'))).status).toBe(403)
      expect(fetcher).not.toHaveBeenCalled()
      const result = await endpoint.handler(request(token))
      expect(result.status).toBe(200)
      expect(await result.json()).toMatchObject({ status: 'paid', amount: 2500, simulated: false })
      expect((await endpoint.handler(request(token))).status).toBe(200)
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(sqlite.prepare('SELECT payment_status FROM form_submissions').get()?.payment_status).toBe('paid')
    } finally { sqlite.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs() }
  })
  it('accepts payments atomically, isolates private tokens, and keeps reconciliation monotonic and idempotent', async () => {
    const { sqlite, binding } = database()
    const accepted = { ...input(), snapshot: { ...input().snapshot, confirmation: 'Order received', redirect: '/thank-you' }, payment: true, paymentDetails: { provider: 'simulator' as const, amount: 2500, currency: 'USD' }, actions: [{ ...input().actions[0], requiresPayment: true }] }
    await acceptSubmission(binding, accepted)
    await acceptSubmission(binding, accepted)
    const read = () => sqlite.prepare('SELECT * FROM form_payment_sessions').get() as unknown as PaymentRow
    const row = read()
    expect(row).toMatchObject({ amount: 2500, currency: 'USD', state: 'pending' })
    const platform = { db: binding, local: true } as FormPlatform
    expect((await paymentView(binding, row, platform)).continueURL).toBeUndefined()
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM form_payment_sessions').get()?.n).toBe(1)
    expect(sqlite.prepare('SELECT status FROM form_outbox').get()?.status).toBe('waiting-payment')
    const token = await paymentToken('secret', row)
    await expect(verifyPaymentToken('secret', row, token)).resolves.toBeUndefined()
    await expect(verifyPaymentToken('secret', { ...row, site: 'another' }, token)).rejects.toThrow('invalid')
    const event = { id: 'success', status: 'paid' as const, amount: 2500, currency: 'USD', refundedAmount: 0, created: 10 }
    await expect(applyPaymentEvent(binding, row, { ...event, amount: 1 })).rejects.toThrow('amount')
    expect(await applyPaymentEvent(binding, row, event)).toBe(true)
    expect(await applyPaymentEvent(binding, row, event)).toBe(false)
    expect(await paymentView(binding, read(), platform)).toMatchObject({ confirmation: 'Order received', continueURL: '/thank-you' })
    expect(sqlite.prepare('SELECT payment_status FROM form_submissions').get()?.payment_status).toBe('simulated')
    expect(sqlite.prepare('SELECT status FROM form_outbox').get()?.status).toBe('pending')
    let deliveries = 0
    const handlers = new ActionHandlers()
    handlers.register('email', async () => { deliveries++ })
    expect(await new FormOutbox(binding, handlers).run('default')).toBe(0)
    expect(deliveries).toBe(0)
    await applyPaymentEvent(binding, read(), { ...event, id: 'late-failure', status: 'failed', created: 9 })
    expect(read().state).toBe('paid')
    await applyPaymentEvent(binding, read(), { ...event, id: 'refund', status: 'refunded', refundedAmount: 2500, created: 11 })
    await applyPaymentEvent(binding, read(), { ...event, id: 'late-success', created: 12 })
    expect(read()).toMatchObject({ state: 'refunded', refunded_amount: 2500 })
    expect((await paymentView(binding, read(), platform)).continueURL).toBeUndefined()
    expect(sqlite.prepare('SELECT status FROM form_outbox').get()?.status).toBe('waiting-payment')
    // A manually replayed job still cannot bypass the payment gate after refund.
    sqlite.prepare("UPDATE form_outbox SET status='pending'").run()
    expect(await new FormOutbox(binding, handlers, undefined, true).run('default')).toBe(0)
    expect(deliveries).toBe(0)
    sqlite.close()
  })
  it('expires private export files and recovers exports interrupted before queue insertion', async () => {
    const { sqlite, binding } = database(), removed: string[] = []
    sqlite.prepare("INSERT INTO form_exports (id,site,status,object_key,expires_at) VALUES (1,'default','complete','form-private/default/exports/1/file.csv','2020-01-01')").run()
    sqlite.prepare("INSERT INTO form_exports (id,site,status,filters) VALUES (2,'default','pending','{}')").run()
    const platform = { db: binding, storage: { async delete(key: string) { removed.push(key) } } } as unknown as FormPlatform
    expect(await maintainForms(platform, 'default')).toMatchObject({ exports: 1 })
    expect(sqlite.prepare('SELECT status,object_key FROM form_exports WHERE id=1').get()).toMatchObject({ status: 'expired', object_key: null })
    expect(removed).toEqual(['form-private/default/exports/1/file.csv'])
    const job = sqlite.prepare("SELECT payload FROM form_outbox WHERE event_i_d='export-2'").get()!
    expect(JSON.parse(String(job.payload)).action).toMatchObject({ kind: 'form-export', config: { exportID: 2 } })
    await maintainForms(platform, 'default')
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM form_outbox WHERE event_i_d='export-2'").get()?.n).toBe(1)
    sqlite.close()
  })
  it('cleans abandoned files with durable retry claims while preserving accepted and active files', async () => {
    const { sqlite, binding } = database()
    for (const [id, expires, submission, site] of [[1, '2020-01-01', null, 'default'], [2, '2099-01-01', null, 'default'], [3, '2020-01-01', 'saved', 'default'], [4, '2020-01-01', null, 'other-site']] as const) {
      sqlite.prepare("INSERT INTO form_attachments (id,site,revision,session_hash,object_key,expires_at,submission_i_d,scan_status) VALUES (?,?,'revision','session',?,?,?,'unscanned')").run(id, site, 'form-private/' + site + '/' + id, expires, submission)
    }
    sqlite.prepare("INSERT INTO form_drafts (site,revision,expires_at) VALUES ('default','revision','2020-01-01')").run()
    let fail = true
    const removed: string[] = []
    const platform = { db: binding, storage: { async delete(key: string) { if (fail) throw new Error('Storage unavailable'); removed.push(key) } } } as unknown as FormPlatform
    expect(await maintainForms(platform, 'default')).toMatchObject({ attachments: 0, retrying: 1, drafts: 1 })
    expect(sqlite.prepare('SELECT scan_status FROM form_attachments WHERE id=1').get()?.scan_status).toBe('deleting')
    fail = false
    expect(await maintainForms(platform, 'default')).toMatchObject({ attachments: 1, retrying: 0 })
    expect(removed).toEqual(['form-private/default/1'])
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM form_attachments').get()?.n).toBe(3)
    sqlite.close()
  })
  it('never reports a clean file without a successful scanner result', async () => {
    const bytes = new Uint8Array([1])
    expect(await scanUpload(undefined, bytes, 'text/plain', 'test.txt')).toBe('unscanned')
    expect(await scanUpload({ name: 'Test adapter', scan: async () => 'clean' }, bytes, 'text/plain', 'test.txt')).toBe('clean')
    expect(await scanUpload({ name: 'Test adapter', scan: async () => 'rejected' }, bytes, 'text/plain', 'test.txt')).toBe('rejected')
    expect(await scanUpload({ name: 'Test adapter', scan: async () => { throw new Error('Provider failure') } }, bytes, 'text/plain', 'test.txt')).toBe('error')
    expect(await scanUpload({ name: 'Test adapter', scan: () => new Promise(() => {}) }, bytes, 'text/plain', 'test.txt', 5)).toBe('error')
  })
  it('honors analytics consent, projects metadata and deduplicates accepted retries atomically', async () => {
    const { sqlite, binding } = database(), definition = emptyDefinition()
    definition.access.analytics = true; definition.access.analyticsConsent = true
    definition.fields = [{ id: 'text', kind: 'text', label: 'Answer' }]
    expect(analyticsEvent(definition, { kind: 'view', eventID: 'event-identifier-one' })).toBeNull()
    const event = analyticsEvent(definition, { kind: 'start', eventID: 'event-identifier-one', consent: true, answers: { text: 'private' }, token: 'private', fields: ['text'] })!
    expect(event).toEqual({ kind: 'start', eventID: 'event-identifier-one', fields: [], step: undefined, durationMs: undefined })
    await recordAnalytics(binding, 'default', 1, 'revision', 'session', event, '2026-01-01T00:00:00.000Z')
    await recordAnalytics(binding, 'default', 1, 'revision', 'session', { ...event, eventID: 'different-client-id' }, '2026-01-01T00:00:01.000Z')
    const submission = { ...input(), analytics: true }
    await acceptSubmission(binding, submission, '2026-01-01T00:00:10.000Z')
    await acceptSubmission(binding, submission, '2026-01-01T00:00:11.000Z')
    const rows = sqlite.prepare('SELECT kind, duration_ms FROM form_analytics ORDER BY id').all()
    expect(rows).toHaveLength(2)
    expect(rows[1].kind).toBe('accepted')
    expect(Number(rows[1].duration_ms)).toBeCloseTo(10000, 0)
    expect(() => analyticsEvent(definition, { kind: 'accepted', consent: true, eventID: 'event-identifier-one' })).toThrow('Unsupported')
    expect(() => analyticsEvent(definition, { kind: 'error', consent: true, eventID: 'event-identifier-one', fields: ['secret-value'] })).toThrow('Unknown')
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM form_analytics').all())).not.toContain('private')
    sqlite.close()
  })
  it('confirms a hold with the entry, rejects expired holds, and cancels capacity without deleting history', async () => {
    const { sqlite, binding } = database(), store = new BookingStore(binding), now = Date.now()
    const startsAt = new Date(now + 86400000).toISOString(), endsAt = new Date(now + 90000000).toISOString()
    sqlite.prepare('INSERT INTO form_resources (id,site,availability) VALUES (1,?,?)').run('default', JSON.stringify([{ id: 'slot', startsAt, endsAt, capacity: 1 }]))
    await store.defineSlot({ id: 'slot', site: 'default', resource: '1', startsAt, endsAt, capacity: 1 })
    const hold = await store.hold('default', 'slot', 'session', 1, 1, now)
    const submission = { ...input(), bookings: [{ tokenHash: await hashToken(hold.token), resource: '1', startsAt }] }
    await expect(acceptSubmission(binding, submission, new Date(now + 61000).toISOString())).rejects.toThrow('reservation expired')
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM form_submissions').get()?.n).toBe(0)
    await acceptSubmission(binding, submission, new Date(now + 1000).toISOString())
    expect(sqlite.prepare('SELECT status, submission_key FROM form_booking_holds').get()).toMatchObject({ status: 'confirmed', submission_key: submission.key })
    await expect(store.hold('default', 'slot', 'other', 1, 1, now + 120000)).rejects.toThrow('no longer')
    await store.cancel('default', submission.key)
    await expect(store.hold('default', 'slot', 'other', 1, 1, now + 120000)).resolves.toBeDefined()
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM form_submissions').get()?.n).toBe(1)
    sqlite.close()
  })
  it('does not accept a previously held slot removed from resource availability', async () => {
    const { sqlite, binding } = database(), store = new BookingStore(binding), now = Date.now()
    const startsAt = new Date(now + 86400000).toISOString()
    sqlite.prepare('INSERT INTO form_resources (id,site,availability) VALUES (1,?,?)').run('default', '[]')
    await store.defineSlot({ id: 'removed', site: 'default', resource: '1', startsAt, endsAt: new Date(now + 90000000).toISOString(), capacity: 1 })
    const hold = await store.hold('default', 'removed', 'session')
    await expect(acceptSubmission(binding, { ...input(), bookings: [{ tokenHash: await hashToken(hold.token), resource: '1', startsAt }] })).rejects.toThrow('reservation expired')
    sqlite.close()
  })
  it('accepts concurrent identical retries once and queues one action', async () => {
    const { sqlite, binding } = database()
    const accepted = await Promise.all([acceptSubmission(binding, input()), acceptSubmission(binding, input())])
    expect(accepted.filter(result => result.created)).toHaveLength(1)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM form_outbox').get()?.n).toBe(1)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM form_submissions').get()?.n).toBe(1)
    sqlite.close()
  })
  it('rejects different-answer races without adding the losing action', async () => {
    const { sqlite, binding } = database()
    const loser = { ...input(), answers: { text: 'Different' }, actions: [{ id: 'other', kind: 'email', name: 'Other', config: {} }] }
    const results = await Promise.allSettled([acceptSubmission(binding, input()), acceptSubmission(binding, loser)])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM form_outbox').get()?.n).toBe(1)
    sqlite.close()
  })
  it('claims private files once and prevents reuse by a second submission', async () => {
    const { sqlite, binding } = database()
    sqlite.prepare("INSERT INTO form_attachments (id,site,revision,session_hash,object_key,field_i_d,expires_at,scan_status) VALUES (1,'default','revision','session','private','upload','2099-01-01','unscanned')").run()
    const submission = { ...input(), attachments: [{ id: '1', fieldID: 'upload' }] }
    await acceptSubmission(binding, submission)
    await expect(acceptSubmission(binding, submission)).resolves.toMatchObject({ created: false })
    await expect(acceptSubmission(binding, { ...submission, key: 'other-key' })).rejects.toThrow('attachment')
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM form_submissions').get()?.n).toBe(1)
    sqlite.close()
  })
})

describe('Durable action processing', () => {
  it('prevents an expired worker from overwriting a newer successful claim', async () => {
    const { sqlite, binding } = database(), handlers = new ActionHandlers()
    let now = Date.now(), release!: () => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    handlers.register('email', async ({ job }) => {
      if (job.attempts === 1) { entered(); await gate; throw new Error('Late failure') }
    })
    await acceptSubmission(binding, input(), new Date(now).toISOString())
    const processor = new FormOutbox(binding, handlers, () => now)
    const first = processor.run('default', 1)
    await waiting
    now += 61000
    expect(await processor.run('default', 1)).toBe(1)
    release(); await first
    expect(sqlite.prepare('SELECT status, attempts FROM form_outbox').get()).toMatchObject({ status: 'complete', attempts: 2 })
    sqlite.close()
  })
  it('retries with backoff, retains the event ID and never replays completed actions', async () => {
    const { sqlite, binding } = database(), handlers = new ActionHandlers()
    let now = Date.now(), calls = 0
    const ids: string[] = []
    handlers.register('email', async ({ job }) => { ids.push(job.event_i_d); if (++calls === 1) throw new Error('provider secret must not enter logs') })
    await acceptSubmission(binding, input(), new Date(now).toISOString())
    const outbox = new FormOutbox(binding, handlers, () => now)
    expect(await outbox.run('default')).toBe(1)
    expect(await outbox.run('default')).toBe(0)
    expect(sqlite.prepare('SELECT attempt_log FROM form_outbox').get()?.attempt_log).not.toContain('provider secret')
    now += 6000
    expect(await outbox.run('default')).toBe(1)
    expect(new Set(ids).size).toBe(1)
    expect(await outbox.run('default')).toBe(0)
    await expect(outbox.replay('default', 1)).rejects.toThrow('Completed actions')
    sqlite.close()
  })
  it('isolates sites and makes unconfigured actions explicitly recoverable', async () => {
    const { sqlite, binding } = database(), handlers = new ActionHandlers()
    let configured = false
    handlers.register('email', async () => { if (!configured) throw new UnconfiguredAction('Configure an email provider.') })
    await acceptSubmission(binding, input())
    const outbox = new FormOutbox(binding, handlers)
    expect(await outbox.run('other-site')).toBe(0)
    expect(await outbox.run('default')).toBe(1)
    expect(sqlite.prepare('SELECT status FROM form_outbox').get()?.status).toBe('unconfigured')
    await expect(outbox.replay('other-site', 1)).rejects.toThrow()
    configured = true
    await outbox.replay('default', 1)
    expect(await outbox.run('default')).toBe(1)
    expect(sqlite.prepare('SELECT status FROM form_outbox').get()?.status).toBe('complete')
    expect(sqlite.prepare('SELECT attempts FROM form_outbox').get()?.attempts).toBe(2)
    sqlite.close()
  })
})
