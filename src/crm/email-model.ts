export interface EmailSettings {
  provider: 'disabled' | 'resend'
  senderEmail: string
  senderName: string
  replyTo: string
  domainID: string
  enabled: boolean
}
export function emailAddress(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      input,
    )
  )
    throw new Error('Enter a valid plain email address.')
  const [local, domain] = input.split('@')
  if (
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    domain.split('.').some((label) => label.length > 63)
  )
    throw new Error('Enter a valid plain email address.')
  return `${local}@${domain.toLowerCase()}`
}
export function emailSettings(input: Record<string, unknown>): EmailSettings {
  if (input.provider !== 'disabled' && input.provider !== 'resend')
    throw new Error('Choose a supported email provider.')
  if (
    typeof input.senderName !== 'string' ||
    input.senderName.length > 120 ||
    /[<>"\r\n\u0000-\u001f]/.test(input.senderName)
  )
    throw new Error('Enter a valid single-line sender name.')
  const domainID = typeof input.domainID === 'string' ? input.domainID : ''
  if (domainID && !/^[a-f0-9-]{36}$/i.test(domainID))
    throw new Error('Enter the provider domain ID.')
  const senderEmail =
    input.senderEmail === '' && input.provider === 'disabled' ? '' : emailAddress(input.senderEmail)
  const replyTo =
    input.replyTo === '' || input.replyTo === undefined ? '' : emailAddress(input.replyTo)
  if (input.provider === 'resend' && !domainID) throw new Error('Enter the provider domain ID.')
  return {
    provider: input.provider,
    senderEmail,
    senderName: input.senderName.trim(),
    replyTo,
    domainID,
    enabled: input.enabled === true,
  }
}
/** Stop before the provider's 24-hour deduplication guarantee expires. */
export function withinEmailRetryWindow(firstAttempt: string, now: number): boolean {
  const first = Date.parse(firstAttempt)
  return Number.isFinite(first) && first <= now && now - first < 23 * 60 * 60 * 1000
}
export interface ProviderEmail {
  from: string
  to: [string]
  subject: string
  text: string
  html: string
  reply_to?: string
  headers: { 'X-VortiCause-Delivery': string }
  attachments?: Array<{ filename: string; content: string }>
}
