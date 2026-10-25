import { SiteAccessError } from '../organizations/repository'
import { scopeImportRun } from './import-access'
import { ImportContext, importReferenceRules } from './import-context'
import { importFields } from './import-model'

const choices = {
  households: { from: 'vc_crm_households r', label: 'r.name', where: 'r.archived=0' },
  'relationship-types': {
    from: 'vc_crm_relationship_types r',
    label: "r.label||' / '||r.reciprocal_label",
    where: 'r.archived=0',
  },
  funds: { from: 'vc_crm_funds r', label: 'r.name', where: 'r.archived=0' },
  campaigns: { from: 'vc_crm_campaigns r', label: 'r.name', where: 'r.archived=0' },
  appeals: { from: 'vc_crm_appeals r', label: 'r.name', where: 'r.archived=0' },
  'membership-types': { from: 'vc_crm_membership_types r', label: 'r.name', where: 'r.archived=0' },
  'volunteer-activities': {
    from: 'vc_crm_volunteer_activities r',
    label: 'r.name',
    where: 'r.archived=0',
  },
  memberships: {
    from: 'vc_crm_membership_terms r LEFT JOIN vc_crm_constituents c ON c.id=r.person_id LEFT JOIN vc_crm_households h ON h.id=r.household_id AND h.site_id=r.site_id',
    label:
      "coalesce(c.label,h.name,'Membership')||' · '||r.type_name||' · '||r.starts_on||' to '||r.ends_on",
    where: `EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents b ON b.id=a.constituent_id AND b.archived=0 WHERE a.site_id=r.site_id AND a.constituent_id=r.billing_contact_id AND a.archived=0)
      AND(r.person_id IS NULL OR EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents b ON b.id=a.constituent_id AND b.archived=0 WHERE a.site_id=r.site_id AND a.constituent_id=r.person_id AND a.archived=0))
      AND(r.household_id IS NULL OR(h.id IS NOT NULL AND h.archived=0))
      AND NOT EXISTS(SELECT 1 FROM vc_crm_membership_coverage m WHERE m.term_id=r.id AND NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents b ON b.id=a.constituent_id AND b.archived=0 WHERE a.site_id=r.site_id AND a.constituent_id=m.constituent_id AND a.archived=0))`,
  },
} as const

/** The selected import field, not caller-authored SQL or category names, chooses
 * the reference domain. Suggestions never mutate records or claim source IDs. */
export class ImportReferenceOptions {
  constructor(
    private db: D1Database,
    private actor: number,
  ) {}
  async list(input: { site: string; id: string; field: string; search?: string; after?: string }) {
    const { run } = await scopeImportRun(this.db, this.actor, input.site, input.id, 'edit'),
      reference = importFields(run.domain).find((field) => field.id === input.field)?.reference
    if (!reference || reference === 'contacts' || !Object.hasOwn(choices, reference))
      throw Error('Choose a supported linked import field.')
    const search = input.search || '',
      after = input.after || ''
    if (
      typeof search !== 'string' ||
      new TextEncoder().encode(search).length > 180 ||
      typeof after !== 'string' ||
      after.length > 128
    )
      throw Error('Choose a shorter search and a valid page cursor.')
    const ctx = await ImportContext.open(
      this.db,
      this.actor,
      input.site,
      run.domain,
      run.source_system,
    )
    await ctx.require(importReferenceRules[reference].category, 'read')
    const definition = choices[reference],
      pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%',
      rows = await this.db
        .prepare(
          `SELECT r.id,${definition.label} AS label FROM ${definition.from} WHERE r.site_id=? AND ${definition.where} AND r.id>? AND(${definition.label}) LIKE ? ESCAPE '\\' ORDER BY r.id LIMIT 26`,
        )
        .bind(input.site, after, pattern)
        .all<{ id: string; label: string }>()
    const docs = rows.results.slice(0, 25)
    for (const doc of docs) {
      await ctx.reference(reference, doc.id)
      if (reference === 'memberships') {
        const term = await this.db
          .prepare(
            'SELECT billing_contact_id,person_id,household_id FROM vc_crm_membership_terms WHERE id=? AND site_id=?',
          )
          .bind(doc.id, input.site)
          .first<{
            billing_contact_id: string
            person_id: string | null
            household_id: string | null
          }>()
        if (!term) throw new SiteAccessError()
        await ctx.reference('contacts', term.billing_contact_id)
        if (term.person_id) await ctx.reference('contacts', term.person_id)
        if (term.household_id) await ctx.reference('households', term.household_id)
        const covered = await this.db
          .prepare('SELECT constituent_id FROM vc_crm_membership_coverage WHERE term_id=?')
          .bind(doc.id)
          .all<{ constituent_id: string }>()
        await ctx.coverContacts(covered.results.map((row) => row.constituent_id))
      }
    }
    await ctx.finish()
    const current = await scopeImportRun(this.db, this.actor, input.site, input.id, 'edit')
    if (current.site.authorityRevision !== ctx.site.authorityRevision) throw new SiteAccessError()
    return { docs, next: rows.results.length > 25 ? docs[24].id : null }
  }
}
