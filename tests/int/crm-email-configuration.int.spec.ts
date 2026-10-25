import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { crmJobSchemaV1 } from '../../src/crm/job-schema-v1'
import { correspondenceSchemaV1 } from '../../src/crm/correspondence-schema-v1'
import { emailSchemaV1 } from '../../src/crm/email-schema-v1'
import { EmailConfiguration } from '../../src/crm/email-configuration'
import type { EmailRuntime } from '../../src/crm/email-provider'
let fixture: ReturnType<typeof localD1>
const runtime: EmailRuntime = {
  environment: 'production',
  local: false,
  liveSendingEnabled: false,
  apiKey: 're_fictional_configuration_key',
}
const values = {
  provider: 'resend',
  senderEmail: 'receipts@example.org',
  senderName: 'Fictional nonprofit',
  replyTo: '',
  domainID: '00000000-0000-4000-8000-000000000001',
  enabled: false,
}
const response = () =>
  Response.json({ name: 'example.org', status: 'verified', capabilities: { sending: 'enabled' } })
beforeEach(() => {
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
})
afterEach(() => fixture.close())
it('requires verification and explicit production enablement while retaining no plaintext credentials', async () => {
  const transport = vi.fn<typeof fetch>(async () => response())
  const config = new EmailConfiguration(fixture.db, 1, runtime, transport)
  expect((await config.get('default')).ready).toBe(false)
  const save = { site: 'default', expectedRevision: 0, operationKey: crypto.randomUUID(), values }
  await config.save(save)
  await config.save(save)
  await expect(
    config.save({
      ...save,
      expectedRevision: 1,
      operationKey: crypto.randomUUID(),
      values: { ...values, enabled: true },
    }),
  ).rejects.toThrow('verified')
  await config.verify({ site: 'default', expectedRevision: 1, operationKey: crypto.randomUUID() })
  expect((await config.get('default')).verified).toBe(true)
  expect((await config.get('default')).ready).toBe(false)
  await expect(
    config.save({
      site: 'default',
      expectedRevision: 2,
      operationKey: crypto.randomUUID(),
      values: { ...values, enabled: true },
    }),
  ).rejects.toThrow('production')
  const live = new EmailConfiguration(
    fixture.db,
    1,
    { ...runtime, liveSendingEnabled: true },
    transport,
  )
  await live.save({
    site: 'default',
    expectedRevision: 2,
    operationKey: crypto.randomUUID(),
    values: { ...values, enabled: true },
  })
  expect((await live.get('default')).ready).toBe(true)
  const changedKey = new EmailConfiguration(
    fixture.db,
    1,
    { ...runtime, liveSendingEnabled: true, apiKey: 're_different_fictional_configuration_key' },
    transport,
  )
  expect((await changedKey.get('default')).verified).toBe(false)
  expect((await changedKey.get('default')).ready).toBe(false)
  const stored = JSON.stringify([
    fixture.sqlite.prepare('SELECT * FROM vc_crm_email_settings').all(),
    fixture.sqlite.prepare('SELECT * FROM vc_platform_audit').all(),
    await live.get('default'),
  ])
  expect(stored).not.toContain(runtime.apiKey)
  expect(transport).toHaveBeenCalledTimes(1)
  expect(transport.mock.calls[0][1]?.method).toBeUndefined()
})
it('rejects verification if settings changed while the provider was queried', async () => {
  const transport = vi.fn<typeof fetch>(async () => {
    await config.save({
      site: 'default',
      expectedRevision: 1,
      operationKey: crypto.randomUUID(),
      values: { ...values, senderEmail: 'changed@example.org' },
    })
    return response()
  })
  const config = new EmailConfiguration(fixture.db, 1, runtime, transport)
  await config.save({
    site: 'default',
    expectedRevision: 0,
    operationKey: crypto.randomUUID(),
    values,
  })
  await expect(
    config.verify({ site: 'default', expectedRevision: 1, operationKey: crypto.randomUUID() }),
  ).rejects.toThrow()
  expect((await config.get('default')).verified).toBe(false)
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) AS n FROM vc_platform_audit WHERE action='email.settings.verified'")
      .get(),
  ).toEqual({ n: 0 })
})
it('denies ungranted configuration access and makes no provider calls for local environments', async () => {
  const transport = vi.fn<typeof fetch>()
  const editor = new EmailConfiguration(fixture.db, 2, runtime, transport)
  await expect(editor.get('default')).rejects.toThrow()
  await expect(
    editor.save({
      site: 'default',
      expectedRevision: 0,
      operationKey: crypto.randomUUID(),
      values,
    }),
  ).rejects.toThrow()
  const local = new EmailConfiguration(fixture.db, 1, { ...runtime, local: true }, transport)
  await local.save({
    site: 'default',
    expectedRevision: 0,
    operationKey: crypto.randomUUID(),
    values,
  })
  await expect(
    local.verify({ site: 'default', expectedRevision: 1, operationKey: crypto.randomUUID() }),
  ).rejects.toThrow('not configured')
  expect(transport).not.toHaveBeenCalled()
})
