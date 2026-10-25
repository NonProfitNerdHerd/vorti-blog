import { emailAddress, withinEmailRetryWindow, type ProviderEmail } from './email-model'
export interface EmailRuntime {
  environment: 'production' | 'development' | 'test'
  local: boolean
  liveSendingEnabled: boolean
  apiKey?: string
}
export interface RetrievedEmail {
  id: string
  from: string
  to: string[]
  subject: string
  text: string | null
  html: string | null
  cc: string[] | null
  bcc: string[] | null
  reply_to: string[] | null
  last_event: string
  created_at: string
}
export function emailRuntimeFromBindings(
  bindings: {
    CRM_EMAIL_ENVIRONMENT?: string
    CRM_EMAIL_LIVE_SEND_ENABLED?: string
    CRM_EMAIL_RESEND_API_KEY?: string
  },
  local: boolean,
): EmailRuntime {
  return {
    environment:
      bindings.CRM_EMAIL_ENVIRONMENT === 'production'
        ? 'production'
        : bindings.CRM_EMAIL_ENVIRONMENT === 'test'
          ? 'test'
          : 'development',
    local,
    liveSendingEnabled: bindings.CRM_EMAIL_LIVE_SEND_ENABLED === 'true',
    apiKey: bindings.CRM_EMAIL_RESEND_API_KEY,
  }
}
export class EmailProviderError extends Error {
  constructor(public kind: 'unconfigured' | 'rejected' | 'uncertain' | 'reconcile') {
    super(
      {
        unconfigured: 'Email delivery is not configured for this environment.',
        rejected: 'The email provider rejected this request. Review configuration before retrying.',
        uncertain: 'The provider outcome is uncertain. Retain the original retry key.',
        reconcile:
          'The safe retry window expired. Reconcile the provider outcome before sending again.',
      }[kind],
    )
  }
}
/** Fixed endpoint, server credentials, immutable serialized payload and stable idempotency key. */
export class ResendEmailProvider {
  constructor(
    private runtime: EmailRuntime,
    private transport: typeof fetch = fetch,
  ) {}
  get configured() {
    return (
      this.runtime.environment === 'production' &&
      !this.runtime.local &&
      typeof this.runtime.apiKey === 'string' &&
      /^re_[A-Za-z0-9_-]{8,200}$/.test(this.runtime.apiKey)
    )
  }
  get canSend() {
    return this.configured && this.runtime.liveSendingEnabled
  }
  private authorization() {
    if (!this.configured) throw new EmailProviderError('unconfigured')
    return { Authorization: `Bearer ${this.runtime.apiKey}` }
  }
  async verifyDomain(domainID: string, sender: string) {
    if (!/^[a-f0-9-]{36}$/i.test(domainID)) throw new EmailProviderError('rejected')
    const address = emailAddress(sender)
    try {
      const response = await this.transport(`https://api.resend.com/domains/${domainID}`, {
        headers: this.authorization(),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      })
      if (!response.ok) throw new EmailProviderError('rejected')
      const domain = (await response.json()) as {
        name?: string
        status?: string
        capabilities?: { sending?: string }
      }
      if (
        domain.name?.toLowerCase() !== address.split('@')[1] ||
        domain.status !== 'verified' ||
        domain.capabilities?.sending !== 'enabled'
      )
        throw new EmailProviderError('rejected')
    } catch (error) {
      if (error instanceof EmailProviderError) throw error
      throw new EmailProviderError('uncertain')
    }
  }
  async retrieve(id: string): Promise<RetrievedEmail> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
      throw new EmailProviderError('rejected')
    try {
      const response = await this.transport(`https://api.resend.com/emails/${id}`, {
        headers: this.authorization(),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      })
      if (!response.ok) throw new EmailProviderError('rejected')
      const record = (await response.json()) as RetrievedEmail
      const addresses = (value: unknown, nullable = false) =>
        (nullable && value === null) ||
        (Array.isArray(value) && value.every((item) => typeof item === 'string'))
      if (
        record.id !== id ||
        typeof record.from !== 'string' ||
        !addresses(record.to) ||
        !addresses(record.cc, true) ||
        !addresses(record.bcc, true) ||
        !addresses(record.reply_to, true) ||
        typeof record.subject !== 'string' ||
        (record.text !== null && typeof record.text !== 'string') ||
        (record.html !== null && typeof record.html !== 'string') ||
        typeof record.last_event !== 'string' ||
        typeof record.created_at !== 'string'
      )
        throw new EmailProviderError('rejected')
      return record
    } catch (error) {
      if (error instanceof EmailProviderError) throw error
      throw new EmailProviderError('uncertain')
    }
  }
  async send(
    payload: ProviderEmail,
    key: string,
    firstAttempt: string,
    now = Date.now(),
  ): Promise<string> {
    if (!this.canSend) throw new EmailProviderError('unconfigured')
    if (!withinEmailRetryWindow(firstAttempt, now)) throw new EmailProviderError('reconcile')
    if (
      !/^[A-Za-z0-9:_-]{16,256}$/.test(key) ||
      payload.to.length !== 1 ||
      /[\r\n]/.test(payload.subject) ||
      /[\r\n]/.test(payload.from)
    )
      throw new EmailProviderError('rejected')
    emailAddress(payload.to[0])
    if (payload.reply_to) emailAddress(payload.reply_to)
    const body = JSON.stringify(payload)
    if (new TextEncoder().encode(body).length > 40000000) throw new EmailProviderError('rejected')
    let response: Response
    try {
      response = await this.transport('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          ...this.authorization(),
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body,
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      })
    } catch {
      throw new EmailProviderError('uncertain')
    }
    let result: { id?: unknown; name?: unknown }
    try {
      result = (await response.json()) as typeof result
    } catch {
      throw new EmailProviderError('uncertain')
    }
    if (
      response.ok &&
      typeof result.id === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result.id)
    )
      return result.id
    if (
      [400, 401, 403, 404, 422].includes(response.status) ||
      (response.status === 409 && result.name === 'invalid_idempotent_request')
    )
      throw new EmailProviderError('rejected')
    throw new EmailProviderError('uncertain')
  }
}
