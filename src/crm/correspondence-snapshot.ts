import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { ContactRepository } from './contacts'
import { calendarDate } from './finance'
import {
  mergeCorrespondence,
  templateFields,
  type CorrespondenceField,
} from './correspondence-model'
import { statementGiving, type StatementGift } from './correspondence-giving'

export interface DocumentRequest {
  site: string
  contact: string
  template: string
  issuedOn: string
  issuerName: string
  issuerAddress: string
  gift?: string
  year?: number
  membership?: string
}
/** Resolves merge values only through the actor's chapter authority, never client financial values. */
export async function contactDocumentSnapshot(
  db: D1Database,
  actor: number,
  input: DocumentRequest,
) {
  const authority = new OrganizationRepository(db, actor)
  const site = await authority.require(input.site, 'communications', 'edit')
  const contact = await new ContactRepository(db, actor).get(input.site, input.contact)
  const issuedOn = calendarDate(input.issuedOn)
  if (
    typeof input.issuerName !== 'string' ||
    !input.issuerName.trim() ||
    input.issuerName.length > 240 ||
    typeof input.issuerAddress !== 'string' ||
    input.issuerAddress.length > 2000
  )
    throw new Error('Enter valid issuer details.')
  const template = await db
    .prepare(
      `SELECT t.id,t.kind,t.revision,v.id AS version_id,v.subject,v.body FROM vc_crm_templates t
    JOIN vc_crm_template_versions v ON v.template_id=t.id AND v.revision=t.revision WHERE t.id=? AND t.site_id=? AND t.archived=0`,
    )
    .bind(input.template, input.site)
    .first<{
      id: string
      kind: string
      revision: number
      version_id: string
      subject: string
      body: string
    }>()
  if (!template) throw new SiteAccessError()
  if (template.kind === 'gift-receipt' && !input.gift)
    throw new Error('Choose the recorded gift for this receipt.')
  if (template.kind === 'annual-statement' && input.gift)
    throw new Error('Use the complete year selection for an annual statement.')
  if (template.kind === 'membership-renewal' && input.gift)
    throw new Error('Use the membership term for a renewal document.')
  let gift: StatementGift | null = null
  if (input.gift) {
    await authority.require(input.site, 'finances', 'read')
    gift = await db
      .prepare(
        'SELECT id,received_on,currency,exponent,original_minor,net_minor,kind,state,revision FROM vc_crm_gifts WHERE id=? AND site_id=? AND constituent_id=?',
      )
      .bind(input.gift, input.site, input.contact)
      .first<StatementGift>()
    if (!gift) throw new SiteAccessError()
  }
  const annual: StatementGift[] = []
  let year: number | null = null
  if (template.kind === 'annual-statement') {
    if (!Number.isInteger(input.year) || input.year! < 1900 || input.year! > 9998)
      throw new Error('Choose a valid statement year.')
    year = input.year!
    await authority.require(input.site, 'finances', 'read')
    let after = ''
    while (true) {
      const page = await db
        .prepare(
          'SELECT id,received_on,currency,exponent,original_minor,net_minor,kind,state,revision FROM vc_crm_gifts WHERE site_id=? AND constituent_id=? AND received_on>=? AND received_on<? AND id>? ORDER BY id LIMIT 200',
        )
        .bind(input.site, input.contact, `${year}-01-01`, `${year + 1}-01-01`, after)
        .all<StatementGift>()
      annual.push(...page.results)
      if (page.results.length < 200) break
      after = page.results[page.results.length - 1].id
      const current = await authority.require(input.site, 'finances', 'read')
      if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    }
  }
  let membership: {
    id: string
    type_name: string
    starts_on: string
    ends_on: string
    cancelled_on: string | null
    revision: number
  } | null = null
  if (template.kind === 'membership-renewal') {
    await authority.require(input.site, 'memberships', 'read')
    if (!input.membership) throw new Error('Choose the recorded membership term for this renewal.')
    membership = await db
      .prepare(
        'SELECT id,type_name,starts_on,ends_on,cancelled_on,revision FROM vc_crm_membership_terms WHERE id=? AND site_id=? AND billing_contact_id=?',
      )
      .bind(input.membership, input.site, input.contact)
      .first()
    if (!membership) throw new SiteAccessError()
  }
  const address = contact.profile.addresses[0]
  const values: Partial<Record<CorrespondenceField, string>> = {
    'recipient.name': contact.label,
    'recipient.address': address
      ? [address.lines, address.city, address.region, address.postalCode, address.country]
          .filter(Boolean)
          .join('\n')
      : '',
    'issuer.name': input.issuerName.trim(),
    'issuer.address': input.issuerAddress.trim(),
    'document.date': issuedOn,
    // Assigned at issuance. Preview uses an explicit marker rather than a misleading issued number.
    'document.number': '[assigned at issuance]',
  }
  const giving =
    year !== null
      ? statementGiving(
          [...annual].sort(
            (a, b) => a.received_on.localeCompare(b.received_on) || a.id.localeCompare(b.id),
          ),
        )
      : gift
        ? statementGiving([gift])
        : null
  if (giving) values['giving.summary'] = giving.text
  if (membership) {
    values['membership.type'] = membership.type_name
    values['membership.endsOn'] = membership.ends_on
  }
  if (gift) {
    values['gift.date'] = gift.received_on
    values['gift.description'] =
      gift.kind === 'in-kind'
        ? 'Recorded in-kind contribution; no donor valuation included.'
        : `Recorded ${gift.kind} contribution.`
    values['giving.summary'] = giving!.text
  }
  const subject = mergeCorrespondence(template.subject, values)
  // A financial document always includes the ledger summary, even when omitted from a template.
  const requiredAppendix =
    (giving && !templateFields(template.body).includes('giving.summary')
      ? `\n\n${giving.text}`
      : '') +
    (year !== null
      ? `\n\nStatement year: ${year}. Balances include adjustments recorded through issuance.`
      : '') +
    (membership
      ? `\n\nRecorded membership: ${membership.type_name}\nTerm: ${membership.starts_on} through ${membership.ends_on}${membership.cancelled_on ? `\nCancelled on: ${membership.cancelled_on}` : ''}\nThis renewal correspondence does not record a renewal or payment.`
      : '')
  const body = mergeCorrespondence(template.body, values) + requiredAppendix
  const current = await authority.require(input.site, 'communications', 'edit')
  if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
  return {
    site: input.site,
    organization: site.organization_id,
    authorityRevision: site.authorityRevision,
    constituent: input.contact,
    contactRevision: contact.revision,
    affiliationRevision: contact.affiliationRevision,
    template: {
      id: template.id,
      revision: template.revision,
      version: template.version_id,
      kind: template.kind,
    },
    issuer: { name: input.issuerName.trim(), address: input.issuerAddress.trim() },
    recipient: { name: contact.label, address: values['recipient.address']! },
    issuedOn,
    subject,
    body,
    requiredAppendix,
    values,
    financial: !!giving,
    gift,
    year,
    annual,
    membership,
    giving,
  }
}
