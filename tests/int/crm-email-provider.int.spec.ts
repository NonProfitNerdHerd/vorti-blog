import { expect, it, vi } from 'vitest'
import {
  emailAddress,
  emailSettings,
  withinEmailRetryWindow,
  type ProviderEmail,
} from '../../src/crm/email-model'
import {
  EmailProviderError,
  ResendEmailProvider,
  type EmailRuntime,
} from '../../src/crm/email-provider'
const now = Date.parse('2026-10-24T12:00:00Z'),
  first = new Date(now).toISOString()
const runtime: EmailRuntime = {
  environment: 'production',
  local: false,
  liveSendingEnabled: true,
  apiKey: 're_fictional_test_only_key',
}
const payload: ProviderEmail = {
  from: 'Fictional nonprofit <receipts@example.org>',
  to: ['fictional@example.net'],
  subject: 'Receipt',
  text: 'Fictional document',
  html: '<p>Fictional document</p>',
  headers: { 'X-VortiCause-Delivery': 'fictional-delivery-id' },
}
it('validates sender settings and rejects mail header injection', () => {
  expect(emailAddress('Donor@EXAMPLE.org')).toBe('Donor@example.org')
  for (const address of [
    'a@example.org\r\nBcc: a@elsewhere.org',
    'Name <a@example.org>',
    '.a@example.org',
    'a..b@example.org',
    'a@localhost',
  ])
    expect(() => emailAddress(address)).toThrow()
  expect(() =>
    emailSettings({
      provider: 'resend',
      senderEmail: 'a@example.org',
      senderName: 'Name\nInjected',
      domainID: crypto.randomUUID(),
    }),
  ).toThrow()
})
it('makes no network calls in development, local, unconfigured or disabled environments', async () => {
  const transport = vi.fn<typeof fetch>()
  const cases: Partial<EmailRuntime>[] = [
    { environment: 'development' },
    { environment: 'test' },
    { local: true },
    { liveSendingEnabled: false },
    { apiKey: undefined },
  ]
  for (const overrides of cases)
    await expect(
      new ResendEmailProvider({ ...runtime, ...overrides }, transport).send(
        payload,
        'fictional-idempotency-key',
        first,
        now,
      ),
    ).rejects.toMatchObject({ kind: 'unconfigured' })
  expect(transport).not.toHaveBeenCalled()
})
it('retains identical retry content/key and stops before provider deduplication expires', async () => {
  const id = crypto.randomUUID(),
    transport = vi.fn<typeof fetch>(async () => Response.json({ id }))
  const provider = new ResendEmailProvider(runtime, transport)
  expect(await provider.send(payload, 'fictional-idempotency-key', first, now)).toBe(id)
  expect(await provider.send(payload, 'fictional-idempotency-key', first, now + 1000)).toBe(id)
  expect(transport.mock.calls[0][0]).toBe('https://api.resend.com/emails')
  expect(transport.mock.calls[0][1]?.body).toBe(transport.mock.calls[1][1]?.body)
  expect(transport.mock.calls[0][1]?.headers).toEqual(transport.mock.calls[1][1]?.headers)
  expect(withinEmailRetryWindow(first, now + 23 * 3600000)).toBe(false)
  await expect(
    provider.send(payload, 'fictional-idempotency-key', first, now + 23 * 3600000),
  ).rejects.toMatchObject({ kind: 'reconcile' })
  expect(transport).toHaveBeenCalledTimes(2)
})
it('distinguishes provider rejection from uncertain outcomes without exposing private errors', async () => {
  const rejected = new ResendEmailProvider(
    runtime,
    vi.fn<typeof fetch>(async () =>
      Response.json({ message: 'private recipient error' }, { status: 422 }),
    ),
  )
  await expect(
    rejected.send(payload, 'fictional-idempotency-key', first, now),
  ).rejects.toMatchObject({ kind: 'rejected' })
  const uncertain = new ResendEmailProvider(
    runtime,
    vi.fn<typeof fetch>(async () => {
      throw new Error('private transport detail')
    }),
  )
  try {
    await uncertain.send(payload, 'fictional-idempotency-key', first, now)
    throw Error('Expected failure')
  } catch (error) {
    expect(error).toBeInstanceOf(EmailProviderError)
    expect((error as EmailProviderError).kind).toBe('uncertain')
    expect((error as Error).message).not.toContain('private')
  }
})
it('verifies the exact sender domain through a fixed read-only provider endpoint', async () => {
  const domainID = crypto.randomUUID(),
    transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        name: 'example.org',
        status: 'verified',
        capabilities: { sending: 'enabled' },
      }),
    )
  const provider = new ResendEmailProvider(runtime, transport)
  await provider.verifyDomain(domainID, 'receipts@example.org')
  expect(String(transport.mock.calls[0][0])).toBe(`https://api.resend.com/domains/${domainID}`)
  await expect(provider.verifyDomain(domainID, 'receipts@unrelated.org')).rejects.toThrow()
})
