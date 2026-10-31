export const crmRecordTypes = [
  'contact',
  'household',
  'gift',
  'pledge',
  'recurring',
  'membership',
  'opportunity',
  'volunteer-activity',
  'campaign',
  'appeal',
  'fund',
  'volunteer-invitation',
  'volunteer-participation',
  'volunteer-hours',
  'correspondence-document',
  'correspondence-batch',
  'import-run',
] as const
export type CRMRecordType = (typeof crmRecordTypes)[number]
export type CRMRecordLink = { type: CRMRecordType; id: string }

export function crmRecordLink(type: unknown, id: unknown): CRMRecordLink {
  if (
    typeof type !== 'string' ||
    !(crmRecordTypes as readonly string[]).includes(type) ||
    typeof id !== 'string' ||
    !id.trim() ||
    id !== id.trim() ||
    id.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(id)
  )
    throw new Error('Choose a valid CRM record.')
  return { type: type as CRMRecordType, id }
}
