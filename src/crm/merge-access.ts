import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import type { InformationCategory } from '../organizations/policy'
import { ContactRepository } from './contacts'
import { readMergeReferencePage, type MergeReferenceKind } from './merge-references'

const categories = {
  attachments: [],
  'attachment-events': [],
  affiliations: ['identity'],
  corrections: ['communications'],
  'household-primary': ['affiliations'],
  'household-members': ['affiliations'],
  relationships: ['affiliations'],
  gifts: ['finances'],
  commitments: ['finances'],
  'gift-adjustments': ['finances'],
  installments: ['finances'],
  pauses: ['finances'],
  applications: ['finances'],
  memberships: ['memberships'],
  'membership-coverage': ['memberships'],
  'membership-term-coverage': ['memberships'],
  'volunteer-profiles': ['volunteer-experience'],
  'volunteer-participation': ['restricted-activity'],
  'volunteer-invitations': ['communications', 'restricted-activity', 'volunteer-experience'],
  'volunteer-hours': ['volunteer-hours', 'restricted-activity'],
  communications: ['communications'],
  opportunities: ['restricted-activity'],
  'opportunity-stage-history': ['restricted-activity'],
  'opportunity-links': ['restricted-activity', 'finances'],
  documents: ['communications'],
  outbox: ['communications'],
  'document-files': ['communications'],
  'email-events': ['communications'],
  'contact-source-identifiers': ['identity'],
} as const satisfies Record<MergeReferenceKind, readonly InformationCategory[]>

export type MergePair = { site: string; survivor: string; duplicate: string }
/** Internal merge preparation access. Never treats a site context or a root
 * administrator label as authority. Staff-facing record projections and native
 * Task audience checks remain separate requirements. */
export class MergeAccess {
  private readonly authority: OrganizationRepository
  constructor(
    private readonly db: D1Database,
    private readonly actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  async pair(input: MergePair) {
    if (!input.survivor || !input.duplicate || input.survivor === input.duplicate)
      throw new Error('Choose two different constituents for merge review.')
    const scope = await this.authority.require(input.site, 'identity', 'edit')
    if (
      await this.db
        .prepare(
          'SELECT 1 FROM vc_crm_identity_aliases WHERE organization_id=? AND identity_id IN(?,?) LIMIT 1',
        )
        .bind(scope.organization_id, input.survivor, input.duplicate)
        .first()
    )
      throw new Error('Choose the current constituent identities for merge review.')
    const contacts = new ContactRepository(this.db, this.actor)
    const survivor = await contacts.get(input.site, input.survivor)
    const duplicate = await contacts.get(input.site, input.duplicate)
    if (
      !survivor.canEditProfile ||
      !duplicate.canEditProfile ||
      !survivor.canEditChapter ||
      !duplicate.canEditChapter
    )
      throw new SiteAccessError()
    if (
      (await this.authority.require(input.site, 'identity', 'edit')).authorityRevision !==
      scope.authorityRevision
    )
      throw new SiteAccessError()
    return { scope, survivor, duplicate }
  }
  /** Raw output is for the private preservation manifest, not serialization to
   * a browser. Complete approval must scan every page/domain and apply live
   * record visibility and native Task audiences to its separate staff preview. */
  async inventoryPage(input: MergePair & { kind: MergeReferenceKind; after?: string }) {
    const initial = await this.pair(input)
    const page = await readMergeReferencePage(this.db, {
      ...input,
      organization: initial.scope.organization_id,
    })
    const checked = new Set<string>()
    const requireCategory = async (site: string, category: InformationCategory) => {
      const key = `${site}:${category}`
      if (checked.has(key)) return
      for (const operation of ['read', 'edit'] as const) {
        const current = await this.authority.require(site, category, operation)
        if (
          current.organization_id !== initial.scope.organization_id ||
          current.authorityRevision !== initial.scope.authorityRevision
        )
          throw new SiteAccessError()
      }
      checked.add(key)
    }
    for (const row of page.docs) {
      await requireCategory(row.mergeSite, 'identity')
      for (const category of categories[input.kind]) await requireCategory(row.mergeSite, category)
      if (input.kind === 'attachments' || input.kind === 'attachment-events') {
        const attachment =
          input.kind === 'attachments'
            ? row
            : await this.db
                .prepare(
                  'SELECT category,record_type FROM vc_crm_attachments WHERE id=? AND site_id=?',
                )
                .bind(row.attachment_id, row.mergeSite)
                .first<{ category: InformationCategory; record_type: string }>()
        if (!attachment) throw new SiteAccessError()
        await requireCategory(row.mergeSite, attachment.category as InformationCategory)
        const domains: Record<string, InformationCategory> = {
          contact: 'communications',
          household: 'affiliations',
          gift: 'finances',
          pledge: 'finances',
          recurring: 'finances',
          membership: 'memberships',
          opportunity: 'restricted-activity',
          'volunteer-activity': 'restricted-activity',
        }
        const domain = domains[String(attachment.record_type)]
        if (!domain) throw new SiteAccessError()
        await requireCategory(row.mergeSite, domain)
      }
      if (input.kind === 'memberships' && row.dues_commitment_id)
        await requireCategory(row.mergeSite, 'finances')
      if (input.kind === 'contact-source-identifiers' && row.domain === 'volunteer-profiles')
        await requireCategory(row.mergeSite, 'volunteer-experience')
      if (['documents', 'outbox', 'document-files', 'email-events'].includes(input.kind)) {
        const document =
          input.kind === 'documents'
            ? row
            : await this.db
                .prepare(
                  input.kind === 'email-events'
                    ? 'SELECT d.* FROM vc_crm_documents d JOIN vc_crm_email_outbox o ON o.document_id=d.id WHERE o.id=? AND d.site_id=?'
                    : 'SELECT d.* FROM vc_crm_documents d WHERE d.id=? AND d.site_id=?',
                )
                .bind(
                  input.kind === 'email-events' ? row.outbox_id : row.document_id,
                  row.mergeSite,
                )
                .first<Record<string, unknown>>()
        if (!document) throw new SiteAccessError()
        if (document.financial === 1) await requireCategory(row.mergeSite, 'finances')
        if (document.membership === 1) await requireCategory(row.mergeSite, 'memberships')
      }
    }
    const current = await this.pair(input)
    if (
      current.scope.authorityRevision !== initial.scope.authorityRevision ||
      current.survivor.revision !== initial.survivor.revision ||
      current.duplicate.revision !== initial.duplicate.revision ||
      current.survivor.affiliationRevision !== initial.survivor.affiliationRevision ||
      current.duplicate.affiliationRevision !== initial.duplicate.affiliationRevision
    )
      throw new SiteAccessError()
    return {
      ...page,
      authorityRevision: initial.scope.authorityRevision,
      expectedRevisions: {
        survivor: initial.survivor.revision,
        duplicate: initial.duplicate.revision,
      },
    }
  }
}
