import { calendarDate } from './finance'
import type { DocumentRequest } from './correspondence-snapshot'

export type BatchSource = 'contacts' | 'gifts' | 'memberships'
export interface CorrespondenceBatchConfig {
  template: string
  kind: string
  source: BatchSource
  issuedOn: string
  issuerName: string
  issuerAddress: string
  year?: number
}
export interface CorrespondenceRecipient {
  contact: string
  gift?: string
  membership?: string
}
export function batchText(value: unknown, limit: number, required = false) {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim()))
    throw new Error('Enter valid correspondence batch details.')
  return value.trim()
}
export function batchRecordID(value: unknown) {
  const id = batchText(value, 128, true)
  if (/[\u0000-\u001f\u007f]/.test(id)) throw new Error('Choose a valid correspondence record.')
  return id
}
/** The template kind is supplied by the authorized server query, never by the browser. */
export function batchConfiguration(
  values: Record<string, unknown>,
  kind: string,
): CorrespondenceBatchConfig {
  const source =
    kind === 'gift-receipt'
      ? 'gifts'
      : kind === 'membership-renewal'
        ? 'memberships'
        : kind === 'thank-you' && values.source === 'gifts'
          ? 'gifts'
          : 'contacts'
  const year = kind === 'annual-statement' ? Number(values.year) : undefined
  if (kind === 'annual-statement' && (!Number.isInteger(year) || year! < 1900 || year! > 9998))
    throw new Error('Choose a valid statement year.')
  return {
    template: batchRecordID(values.template),
    kind,
    source,
    issuedOn: calendarDate(values.issuedOn),
    issuerName: batchText(values.issuerName, 240, true),
    issuerAddress: batchText(values.issuerAddress, 2000),
    ...(year === undefined ? {} : { year }),
  }
}
export function batchRecipient(
  raw: Record<string, unknown>,
  source: BatchSource,
): CorrespondenceRecipient {
  return {
    contact: batchRecordID(raw.contact),
    ...(source === 'gifts' ? { gift: batchRecordID(raw.gift) } : {}),
    ...(source === 'memberships' ? { membership: batchRecordID(raw.membership) } : {}),
  }
}
export function recipientKey(recipient: CorrespondenceRecipient) {
  return recipient.gift
    ? `gift:${recipient.gift}`
    : recipient.membership
      ? `membership:${recipient.membership}`
      : `contact:${recipient.contact}`
}
export function batchDocumentRequest(
  site: string,
  config: CorrespondenceBatchConfig,
  recipient: CorrespondenceRecipient,
): DocumentRequest {
  return {
    site,
    template: config.template,
    issuedOn: config.issuedOn,
    issuerName: config.issuerName,
    issuerAddress: config.issuerAddress,
    ...(config.year === undefined ? {} : { year: config.year }),
    ...recipient,
  }
}
