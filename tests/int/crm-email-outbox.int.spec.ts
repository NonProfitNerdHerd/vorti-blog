import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { crmJobSchemaV1 } from '../../src/crm/job-schema-v1'
import { correspondenceSchemaV1 } from '../../src/crm/correspondence-schema-v1'
import { emailSchemaV1 } from '../../src/crm/email-schema-v1'
import { EmailConfiguration } from '../../src/crm/email-configuration'
import { EmailOutbox } from '../../src/crm/email-outbox'
import { EmailDispatcher } from '../../src/crm/email-dispatch'
import { EmailReconciler, reconcileNextEmail } from '../../src/crm/email-reconciliation'
import { CorrespondenceDocuments } from '../../src/crm/correspondence-documents'
import { CorrespondenceRepository } from '../../src/crm/correspondence'
import { ContactRepository } from '../../src/crm/contacts'
import type { EmailRuntime } from '../../src/crm/email-provider'
let fixture: ReturnType<typeof localD1>, outbox: EmailOutbox, document: string, contact: string
const runtime: EmailRuntime = {
  environment: 'production',
  local: false,
  liveSendingEnabled: true,
  apiKey: 're_fictional_outbox_key',
}
const profile = {
  kind: 'person',
  firstName: 'Fictional recipient',
  methods: [{ kind: 'email', value: 'fictional@example.net', primary: true }],
}
beforeEach(async () => {
  fixture = localD1()
  fixture.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT);INSERT INTO users VALUES(1,'administrator'),(2,'editor');",
  )
  for (const sql of [
    ...organizationSchema,
    ...defaultOrganizationSeed,
    ...contactSchemaV1,
    ...crmJobSchemaV1,
    ...correspondenceSchemaV1,
    ...emailSchemaV1,
  ])
    fixture.sqlite.exec(sql)
  const config = new EmailConfiguration(
    fixture.db,
    1,
    runtime,
    vi.fn<typeof fetch>(async () =>
      Response.json({
        name: 'example.org',
        status: 'verified',
        capabilities: { sending: 'enabled' },
      }),
    ),
  )
  const values = {
    provider: 'resend',
    senderEmail: 'receipts@example.org',
    senderName: 'Fictional nonprofit',
    replyTo: '',
    domainID: crypto.randomUUID(),
    enabled: false,
  }
  await config.save({
    site: 'default',
    expectedRevision: 0,
    operationKey: crypto.randomUUID(),
    values,
  })
  await config.verify({ site: 'default', expectedRevision: 1, operationKey: crypto.randomUUID() })
  await config.save({
    site: 'default',
    expectedRevision: 2,
    operationKey: crypto.randomUUID(),
    values: { ...values, enabled: true },
  })
  contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile,
        roles: ['contact'],
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  const template = String(
    (
      await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
        site: 'default',
        operationKey: crypto.randomUUID(),
        values: {
          name: 'General',
          kind: 'general',
          subject: 'Thank you',
          body: 'Dear {{recipient.name}}',
        },
      })
    ).id,
  )
  const documents = new CorrespondenceDocuments(fixture.db, 1),
    request = {
      site: 'default',
      contact,
      template,
      issuedOn: '2026-10-24',
      issuerName: 'Fictional nonprofit',
      issuerAddress: '',
    }
  const preview = await documents.preview(request)
  document = String(
    (
      await documents.issue({
        ...request,
        approval: preview.approval,
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  outbox = new EmailOutbox(fixture.db, 1, runtime)
})
afterEach(() => fixture.close())
const request = () => ({
  site: 'default',
  document,
  recipient: 'fictional@example.net',
  includePDF: false,
})
it('queues immutable reviewed content once, with atomic events and intent-bound retry', async () => {
  const preview = await outbox.preview(request())
  expect(preview.text).toContain('Dear Fictional recipient')
  expect(JSON.stringify(preview)).not.toContain('objectKey')
  const queue = { ...request(), approval: preview.approval, operationKey: crypto.randomUUID() }
  const result = await outbox.queue(queue)
  expect(await outbox.queue(queue)).toEqual(result)
  expect((await outbox.get('default', String(result.id))).status).toBe('pending')
  expect((await outbox.get('default', String(result.id))).attempts).toBe(0)
  await expect(outbox.queue({ ...queue, operationKey: crypto.randomUUID() })).rejects.toThrow()
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_email_outbox').get()).toEqual({
    n: 1,
  })
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_email_events').get()).toEqual({
    n: 1,
  })
  expect(() => fixture.sqlite.exec("UPDATE vc_crm_email_outbox SET payload='rewritten'")).toThrow(
    'immutable',
  )
  expect(() => fixture.sqlite.exec('DELETE FROM vc_crm_email_outbox')).toThrow('retained')
  expect(
    (await new EmailOutbox(fixture.db, 2, runtime).get('default', String(result.id))).status,
  ).toBe('pending')
  await expect(new EmailOutbox(fixture.db, 2, runtime).preview(request())).rejects.toThrow()
  await expect(
    new EmailOutbox(fixture.db, 999, runtime).get('default', String(result.id)),
  ).rejects.toThrow()
})
it('rejects stale contact approvals and recipients without current recorded email consent', async () => {
  const preview = await outbox.preview(request())
  await new ContactRepository(fixture.db, 1).updateProfile({
    site: 'default',
    id: contact,
    expectedRevision: 1,
    confirmedSharedUpdate: true,
    operationKey: crypto.randomUUID(),
    profile: { ...profile, firstName: 'Updated fictional recipient' },
  })
  await expect(
    outbox.queue({ ...request(), approval: preview.approval, operationKey: crypto.randomUUID() }),
  ).rejects.toThrow()
  await new ContactRepository(fixture.db, 1).updateProfile({
    site: 'default',
    id: contact,
    expectedRevision: 2,
    confirmedSharedUpdate: true,
    operationKey: crypto.randomUUID(),
    profile: { ...profile, communication: { emailAllowed: false } },
  })
  await expect(outbox.preview(request())).rejects.toThrow('permits email')
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_email_outbox').get()).toEqual({
    n: 0,
  })
})
it('requires valid configuration and completed PDFs for attached correspondence', async () => {
  await expect(outbox.preview({ ...request(), includePDF: true })).rejects.toThrow(
    'completed document PDF',
  )
  await expect(
    outbox.preview({ ...request(), recipient: 'unrecorded@example.net' }),
  ).rejects.toThrow('recorded recipient')
  await expect(
    new EmailOutbox(fixture.db, 1, { ...runtime, local: true }).preview(request()),
  ).rejects.toThrow('not configured')
})
async function queueMessage() {
  const preview = await outbox.preview(request())
  return String(
    (
      await outbox.queue({
        ...request(),
        approval: preview.approval,
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
}
it('pages every retained event and rechecks authorization on each history page', async () => {
  const queued = await queueMessage(),
    base = Date.now() + 1000
  for (let index = 0; index < 105; index++)
    fixture.sqlite
      .prepare(
        "INSERT INTO vc_crm_email_events(id,outbox_id,fence,event,actor_id,detail,created_at) VALUES(?,?,0,'fictional-review',1,'Retained event',?)",
      )
      .run(crypto.randomUUID(), queued, new Date(base + index * 1000).toISOString())
  const seen = new Set<string>()
  let cursor: { date: string; id: string } | null = null
  do {
    const page = await outbox.events('default', queued, cursor?.date || '', cursor?.id || '')
    for (const event of page.docs) {
      expect(seen.has(event.id)).toBe(false)
      seen.add(event.id)
    }
    cursor = page.next
  } while (cursor)
  expect(seen.size).toBe(106)
  await expect(outbox.events('default', queued, 'invalid-date', 'id')).rejects.toThrow(
    'Invalid page',
  )
  await expect(
    new EmailOutbox(fixture.db, 999, runtime).events('default', queued),
  ).rejects.toThrow()
})
it('records provider acceptance once and never sends a confirmed message again', async () => {
  const queued = await queueMessage(),
    providerID = crypto.randomUUID()
  const transport = vi.fn<typeof fetch>(async () => Response.json({ id: providerID }))
  const dispatcher = new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    transport,
    () => Date.now() + 1000,
  )
  expect(await dispatcher.tick()).toBe(true)
  expect((await outbox.get('default', queued)).status).toBe('accepted')
  expect((await outbox.get('default', queued)).providerID).toBe(providerID)
  expect(await dispatcher.tick()).toBe(false)
  expect(transport).toHaveBeenCalledTimes(1)
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) AS n FROM vc_crm_email_events WHERE event='accepted'")
      .get(),
  ).toEqual({ n: 1 })
})
it('recovers a lost provider response using identical content and key without duplicate delivery', async () => {
  const queued = await queueMessage(),
    providerID = crypto.randomUUID()
  let clock = Date.now() + 1000,
    deliveries = 0
  const transport = vi.fn<typeof fetch>(async () => {
    if (!deliveries) {
      deliveries++
      throw Error('Fictional lost response after acceptance')
    }
    return Response.json({ id: providerID })
  })
  const dispatcher = new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    transport,
    () => clock,
  )
  await dispatcher.tick()
  expect((await outbox.get('default', queued)).status).toBe('uncertain')
  clock += 10000
  await dispatcher.tick()
  expect((await outbox.get('default', queued)).status).toBe('accepted')
  expect(deliveries).toBe(1)
  expect(transport).toHaveBeenCalledTimes(2)
  expect(transport.mock.calls[0][1]?.body).toBe(transport.mock.calls[1][1]?.body)
  expect(transport.mock.calls[0][1]?.headers).toEqual(transport.mock.calls[1][1]?.headers)
})
it('freezes uncertain deliveries after the safe retry window without another provider call', async () => {
  const queued = await queueMessage()
  let clock = Date.now() + 1000
  const transport = vi.fn<typeof fetch>(async () => {
    throw Error('Fictional timeout')
  })
  const dispatcher = new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    transport,
    () => clock,
  )
  await dispatcher.tick()
  clock += 24 * 3600000
  await dispatcher.tick()
  const state = await outbox.get('default', queued)
  expect(state.status).toBe('uncertain')
  expect(state.nextAttemptAt).toBe('9999-12-31T23:59:59.999Z')
  expect(state.attempts).toBe(1)
  expect(await dispatcher.tick()).toBe(false)
  expect(transport).toHaveBeenCalledTimes(1)
})
it('rechecks consent before dispatch and makes no network call after revocation', async () => {
  const queued = await queueMessage()
  await new ContactRepository(fixture.db, 1).updateProfile({
    site: 'default',
    id: contact,
    expectedRevision: 1,
    confirmedSharedUpdate: true,
    operationKey: crypto.randomUUID(),
    profile: { ...profile, communication: { emailAllowed: false } },
  })
  const transport = vi.fn<typeof fetch>()
  await new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    transport,
    () => Date.now() + 1000,
  ).tick()
  expect(transport).not.toHaveBeenCalled()
  expect((await outbox.get('default', queued)).status).toBe('failed')
  expect((await outbox.get('default', queued)).firstAttemptAt).toBeNull()
})
it('reclaims an expired lease without duplicate confirmation or changed provider content', async () => {
  const queued = await queueMessage(),
    providerID = crypto.randomUUID()
  let clock = Date.now() + 1000,
    release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const transport = vi.fn<typeof fetch>(async () => {
    if (transport.mock.calls.length === 1) await held
    return Response.json({ id: providerID })
  })
  const dispatcher = new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    transport,
    () => clock,
  )
  const first = dispatcher.tick()
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1))
  clock += 121000
  await dispatcher.tick()
  release()
  await first
  expect((await outbox.get('default', queued)).providerID).toBe(providerID)
  expect(transport.mock.calls[0][1]?.body).toBe(transport.mock.calls[1][1]?.body)
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) AS n FROM vc_crm_email_events WHERE event='accepted'")
      .get(),
  ).toEqual({ n: 1 })
})
it('reconciles an expired uncertain outcome with the exact provider record using reads only', async () => {
  const queued = await queueMessage(),
    providerID = crypto.randomUUID()
  let clock = Date.now() + 1000,
    sentBody: Record<string, unknown> | null = null
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    sentBody = JSON.parse(String(init?.body))
    throw Error('Fictional lost acceptance response')
  })
  const dispatcher = new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    transport,
    () => clock,
  )
  await dispatcher.tick()
  const first = (await outbox.get('default', queued)).firstAttemptAt!
  clock += 24 * 3600000
  await dispatcher.tick()
  const before = await outbox.get('default', queued)
  const retrieve = vi.fn<typeof fetch>(async () =>
    Response.json({
      ...sentBody!,
      id: providerID,
      cc: null,
      bcc: null,
      reply_to: null,
      last_event: 'delivered',
      created_at: first,
    }),
  )
  const reconciler = new EmailReconciler(
    fixture.db,
    1,
    { ...runtime, liveSendingEnabled: false },
    retrieve,
    () => clock,
  )
  const input = {
    site: 'default',
    id: queued,
    providerID,
    expectedRevision: before.revision,
    operationKey: crypto.randomUUID(),
  }
  await reconciler.reconcile(input)
  await reconciler.reconcile(input)
  expect((await outbox.get('default', queued)).status).toBe('delivered')
  expect((await outbox.get('default', queued)).providerID).toBe(providerID)
  expect(retrieve).toHaveBeenCalledTimes(1)
  expect(retrieve.mock.calls[0][1]?.method).toBeUndefined()
  expect(transport).toHaveBeenCalledTimes(1)
  expect(await dispatcher.tick()).toBe(false)
})
it('rejects unrelated provider content and stale reconciliation without changing delivery history', async () => {
  const queued = await queueMessage(),
    providerID = crypto.randomUUID()
  const transport = vi.fn<typeof fetch>(async () => Response.json({ id: providerID }))
  await new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    transport,
    () => Date.now() + 1000,
  ).tick()
  const before = await outbox.get('default', queued)
  const stored = JSON.parse(
    String(
      (
        fixture.sqlite
          .prepare('SELECT payload FROM vc_crm_email_outbox WHERE id=?')
          .get(queued) as { payload: string }
      ).payload,
    ),
  ).message as Record<string, unknown>
  const retrieve = vi.fn<typeof fetch>(async () =>
    Response.json({
      ...stored,
      text: 'Unrelated private correspondence',
      id: providerID,
      cc: null,
      bcc: null,
      reply_to: null,
      last_event: 'delivered',
      created_at: before.firstAttemptAt,
    }),
  )
  const reconciler = new EmailReconciler(fixture.db, 1, runtime, retrieve, () => Date.now() + 1000)
  await expect(
    reconciler.reconcile({
      site: 'default',
      id: queued,
      providerID,
      expectedRevision: before.revision,
      operationKey: crypto.randomUUID(),
    }),
  ).rejects.toThrow('exact provider record')
  await expect(
    reconciler.reconcile({
      site: 'default',
      id: queued,
      providerID,
      expectedRevision: before.revision - 1,
      operationKey: crypto.randomUUID(),
    }),
  ).rejects.toThrow()
  expect(retrieve).toHaveBeenCalledTimes(1)
  expect((await outbox.get('default', queued)).status).toBe('accepted')
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) AS n FROM vc_crm_email_events WHERE event LIKE 'reconciled-%'")
      .get(),
  ).toEqual({ n: 0 })
})
it('polls accepted provider status using reads while new sending is disabled', async () => {
  const queued = await queueMessage(),
    providerID = crypto.randomUUID()
  let clock = Date.now() + 1000,
    sentBody: Record<string, unknown> | null = null
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    sentBody = JSON.parse(String(init?.body))
    return Response.json({ id: providerID })
  })
  await new EmailDispatcher(fixture.db, {} as R2Bucket, runtime, send, () => clock).tick()
  const first = (await outbox.get('default', queued)).firstAttemptAt
  clock += 60001
  const retrieve = vi.fn<typeof fetch>(async () =>
    Response.json({
      ...sentBody!,
      id: providerID,
      cc: null,
      bcc: null,
      reply_to: null,
      last_event: 'delivered',
      created_at: first,
    }),
  )
  expect(
    await reconcileNextEmail(
      fixture.db,
      { ...runtime, liveSendingEnabled: false },
      retrieve,
      () => clock,
    ),
  ).toBe(true)
  expect((await outbox.get('default', queued)).status).toBe('delivered')
  expect(await reconcileNextEmail(fixture.db, runtime, retrieve, () => clock)).toBe(false)
  expect(send).toHaveBeenCalledTimes(1)
  expect(retrieve).toHaveBeenCalledTimes(1)
  expect(retrieve.mock.calls[0][1]?.method).toBeUndefined()
})
it('records acceptance once after a lost database acknowledgement without resending', async () => {
  const queued = await queueMessage(),
    providerID = crypto.randomUUID()
  const send = vi.fn<typeof fetch>(async () => Response.json({ id: providerID }))
  const original = fixture.db.batch.bind(fixture.db)
  let lost = false
  fixture.db.batch = (async (statements) => {
    const result = await original(statements)
    if (!lost && (statements[0] as unknown as { sql: string }).sql.includes('SET provider_id=')) {
      lost = true
      throw Error('Fictional lost database acknowledgement')
    }
    return result
  }) as typeof fixture.db.batch
  await new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    send,
    () => Date.now() + 1000,
  ).tick()
  expect((await outbox.get('default', queued)).status).toBe('accepted')
  expect(send).toHaveBeenCalledTimes(1)
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) AS n FROM vc_crm_email_events WHERE event='accepted'")
      .get(),
  ).toEqual({ n: 1 })
})
it('rolls back the dispatch checkpoint when consent changes after preflight', async () => {
  const queued = await queueMessage(),
    send = vi.fn<typeof fetch>()
  const original = fixture.db.batch.bind(fixture.db)
  let changed = false
  fixture.db.batch = (async (statements) => {
    if (
      !changed &&
      (statements[0] as unknown as { sql: string }).sql.includes('SET first_attempt_at=')
    ) {
      changed = true
      await new ContactRepository(fixture.db, 1).updateProfile({
        site: 'default',
        id: contact,
        expectedRevision: 1,
        confirmedSharedUpdate: true,
        operationKey: crypto.randomUUID(),
        profile: { ...profile, communication: { emailAllowed: false } },
      })
    }
    return original(statements)
  }) as typeof fixture.db.batch
  await new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    send,
    () => Date.now() + 1000,
  ).tick()
  expect(send).not.toHaveBeenCalled()
  expect((await outbox.get('default', queued)).firstAttemptAt).toBeNull()
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) AS n FROM vc_crm_email_events WHERE event='dispatch-started'")
      .get(),
  ).toEqual({ n: 0 })
})
it('cancels pending delivery, retries the unchanged message and rejects stale controls or accepted resends', async () => {
  const queued = await queueMessage(),
    original = fixture.sqlite
      .prepare('SELECT payload,idempotency_key FROM vc_crm_email_outbox WHERE id=?')
      .get(queued)
  const before = await outbox.get('default', queued)
  const cancel = {
    site: 'default',
    id: queued,
    expectedRevision: before.revision,
    action: 'cancel' as const,
    operationKey: crypto.randomUUID(),
  }
  await outbox.control(cancel)
  await outbox.control(cancel)
  expect((await outbox.get('default', queued)).status).toBe('cancelled')
  await expect(outbox.control({ ...cancel, operationKey: crypto.randomUUID() })).rejects.toThrow()
  const stopped = await outbox.get('default', queued)
  await outbox.control({
    site: 'default',
    id: queued,
    expectedRevision: stopped.revision,
    action: 'retry',
    operationKey: crypto.randomUUID(),
  })
  expect(
    fixture.sqlite
      .prepare('SELECT payload,idempotency_key FROM vc_crm_email_outbox WHERE id=?')
      .get(queued),
  ).toEqual(original)
  const send = vi.fn<typeof fetch>(async () => Response.json({ id: crypto.randomUUID() }))
  await new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    send,
    () => Date.now() + 1000,
  ).tick()
  const accepted = await outbox.get('default', queued)
  await expect(
    outbox.control({
      site: 'default',
      id: queued,
      expectedRevision: accepted.revision,
      action: 'retry',
      operationKey: crypto.randomUUID(),
    }),
  ).rejects.toThrow('accepted')
  await expect(
    outbox.control({
      site: 'default',
      id: queued,
      expectedRevision: accepted.revision,
      action: 'cancel',
      operationKey: crypto.randomUUID(),
    }),
  ).rejects.toThrow('accepted')
  expect(send).toHaveBeenCalledTimes(1)
})
it('retains a late provider acceptance after an in-flight cancellation request', async () => {
  const queued = await queueMessage(),
    providerID = crypto.randomUUID()
  const send = vi.fn<typeof fetch>(async () => {
    const active = await outbox.get('default', queued)
    await outbox.control({
      site: 'default',
      id: queued,
      expectedRevision: active.revision,
      action: 'cancel',
      operationKey: crypto.randomUUID(),
    })
    expect((await outbox.get('default', queued)).status).toBe('uncertain')
    return Response.json({ id: providerID })
  })
  await new EmailDispatcher(
    fixture.db,
    {} as R2Bucket,
    runtime,
    send,
    () => Date.now() + 1000,
  ).tick()
  const accepted = await outbox.get('default', queued)
  expect(accepted.status).toBe('accepted')
  expect(accepted.cancelRequested).toBe(true)
  expect(accepted.providerID).toBe(providerID)
})
