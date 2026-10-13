import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { createActionHandlers } from '@/forms/action-runtime'
import type { FormPlatform } from '@/forms/platform'
import { UnconfiguredAction, type OutboxJob } from '@/forms/outbox'

describe('notification delivery truthfulness', () => {
  function setup(local: boolean, configured = false, integration = '') {
    const run = vi.fn().mockResolvedValue({})
    const statement = { bind: (..._values: unknown[]) => statement, first: async () => ({ answers: '{"name":"A & B"}', schema_snapshot: '{"fields":[{"id":"name","kind":"text","label":"Name"}]}' }), run }
    const platform = { local, db: { prepare: () => statement } } as unknown as FormPlatform
    const sendEmail = vi.fn().mockResolvedValue({})
    const payload = { email: { name: configured ? 'configured-provider' : 'console' }, sendEmail } as unknown as Payload
    const job = { kind: 'email', site: 'default', revision: 'v1', submission_i_d: '1', event_i_d: 'event-one', payload: JSON.stringify({ action: { kind: 'email', config: { to: 'owner@example.test', subject: 'New entry', body: '{{summary}}', integration } } }) } as OutboxJob
    return { handlers: createActionHandlers(platform, payload), job, run, sendEmail }
  }
  it('captures only in the explicit local environment', async () => {
    const local = setup(true)
    await local.handlers.dispatch(local.job)
    expect(local.run).toHaveBeenCalledOnce()
    expect(local.sendEmail).not.toHaveBeenCalled()
    const production = setup(false)
    await expect(production.handlers.dispatch(production.job)).rejects.toBeInstanceOf(UnconfiguredAction)
    expect(production.run).not.toHaveBeenCalled()
  })
  it('reports an unconfigured site provider instead of pretending to send', async () => {
    const test = setup(false, false, 'default')
    await expect(test.handlers.dispatch(test.job)).rejects.toBeInstanceOf(UnconfiguredAction)
    expect(test.sendEmail).not.toHaveBeenCalled()
  })
  it('uses the selected site provider with escaped content and a stable message identity', async () => {
    const test = setup(false, true, 'default')
    await test.handlers.dispatch(test.job)
    expect(test.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ['owner@example.test'], html: '<pre>Name: A &amp; B</pre>', messageId: '<forms-event-one@forms.local>' }))
  })
})
