import { ImportContext } from './import-context'
import { ContactRepository } from './contacts'
import { HouseholdRepository } from './households'
import { FinanceRepository } from './finance'
import { MembershipRepository } from './memberships'
import { VolunteerRepository } from './volunteers'

/** Read complete authorized target state for review; no paginated list is used
 * as evidence of absence or as the source of financial/membership balances.
 */
export async function readImportTarget(
  ctx: ImportContext,
  id: string,
): Promise<Record<string, unknown>> {
  const { db, actor, siteID: site, domain } = ctx
  if (domain === 'contacts') {
    const doc = await new ContactRepository(db, actor).get(site, id)
    await ctx.reference('contacts', id)
    return doc as unknown as Record<string, unknown>
  }
  if (domain === 'households') {
    const { doc } = await new HouseholdRepository(db, actor).get(site, id)
    await ctx.reference('households', id, 'record', true)
    if (doc.primary_contact) await ctx.reference('contacts', doc.primary_contact)
    const raw = await db
      .prepare('SELECT primary_contact FROM vc_crm_households WHERE site_id=? AND id=?')
      .bind(site, id)
      .first<{ primary_contact: string | null }>()
    return { ...doc, primaryNeedsReview: !!raw?.primary_contact && !doc.primary_contact }
  }
  if (domain === 'gifts') {
    const {
      adjustments: _adjustments,
      adjustmentTotal: _count,
      adjustmentPage: _page,
      canEdit: _edit,
      ...doc
    } = await new FinanceRepository(db, actor).get(site, id)
    await ctx.reference('contacts', doc.constituent)
    ctx.remember(
      'SELECT id,revision FROM vc_crm_gifts WHERE site_id=? AND id=?',
      [site, id],
      { revision: doc.revision },
      ['revision'],
    )
    return doc as unknown as Record<string, unknown>
  }
  if (domain === 'memberships') {
    const raw = await db
      .prepare('SELECT starts_on FROM vc_crm_membership_terms WHERE site_id=? AND id=?')
      .bind(site, id)
      .first<{ starts_on: string }>()
    if (!raw) throw new Error('Choose a membership available in this chapter.')
    const { doc, covered } = await new MembershipRepository(db, actor).get(site, id, raw.starts_on)
    const { status: _status, ...term } = doc
    await ctx.coverContacts(covered.map((contact) => contact.id))
    if (BigInt(doc.dues_minor) > 0n) await ctx.require('finances', 'read')
    await ctx.reference('contacts', doc.billing_contact_id)
    const query = `SELECT json_group_array(json_object('id',id,'label',label)) AS coverage FROM (
      SELECT c.id,c.label FROM vc_crm_membership_coverage m JOIN vc_crm_constituents c ON c.id=m.constituent_id AND c.archived=0
      JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=? AND a.archived=0 WHERE m.term_id=? ORDER BY c.id)`
    const snapshot = (await db.prepare(query).bind(site, id).first<{ coverage: string }>())!
    ctx.remember(query, [site, id], snapshot, ['coverage'])
    ctx.remember(
      'SELECT id,revision FROM vc_crm_membership_terms WHERE site_id=? AND id=?',
      [site, id],
      { revision: doc.revision },
      ['revision'],
    )
    return { ...term, covered }
  }
  if (domain === 'volunteer-profiles') {
    const { doc } = await new VolunteerRepository(db, actor).getProfile(site, id)
    await ctx.reference('contacts', id)
    ctx.remember(
      'SELECT constituent_id,revision FROM vc_crm_volunteer_profiles WHERE site_id=? AND constituent_id=?',
      [site, id],
      { revision: doc.revision },
      ['revision'],
    )
    return { ...doc, id }
  }
  if (domain === 'volunteer-activities')
    return { ...(await ctx.reference('volunteer-activities', id, 'record', true)) }
  const sql =
    domain === 'household-members'
      ? `SELECT m.* FROM vc_crm_household_members m JOIN vc_crm_households h ON h.id=m.household_id WHERE h.site_id=? AND m.id=?`
      : domain === 'relationships'
        ? 'SELECT * FROM vc_crm_relationships WHERE site_id=? AND id=?'
        : domain === 'volunteer-participation'
          ? 'SELECT p.* FROM vc_crm_volunteer_participation p JOIN vc_crm_volunteer_activities a ON a.id=p.activity_id WHERE a.site_id=? AND p.id=?'
          : 'SELECT p.* FROM vc_crm_volunteer_hours p JOIN vc_crm_volunteer_activities a ON a.id=p.activity_id WHERE a.site_id=? AND p.id=?'
  const doc = await db.prepare(sql).bind(site, id).first<Record<string, unknown>>()
  if (!doc) throw new Error('Choose an existing record available in this chapter.')
  if (domain === 'relationships') {
    await ctx.reference('contacts', String(doc.source_id))
    await ctx.reference('contacts', String(doc.target_id))
    await ctx.reference('relationship-types', String(doc.type_id), 'record', true)
  } else {
    await ctx.reference('contacts', String(doc.constituent_id))
    if (domain === 'household-members')
      await ctx.reference('households', String(doc.household_id), 'record', true)
    else await ctx.reference('volunteer-activities', String(doc.activity_id), 'record', true)
  }
  ctx.remember(sql, [site, id], doc, ['revision'])
  return doc
}
