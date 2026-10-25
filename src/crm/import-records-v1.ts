/** Frozen source-identifier contexts used by migration guards. New record domains
 * or alias resolution require a new version/migration, not edits to this contract.
 */
export const importRecordQueriesV1 = {
  contacts: `SELECT c.id FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.organization_id=c.organization_id WHERE a.site_id=? AND c.id=? AND c.archived=0 AND a.archived=0`,
  households: `SELECT id FROM vc_crm_households WHERE site_id=? AND id=?`,
  'household-members': `SELECT m.id FROM vc_crm_household_members m JOIN vc_crm_households h ON h.id=m.household_id WHERE h.site_id=? AND m.id=?`,
  relationships: `SELECT id FROM vc_crm_relationships WHERE site_id=? AND id=?`,
  gifts: `SELECT id FROM vc_crm_gifts WHERE site_id=? AND id=?`,
  memberships: `SELECT id FROM vc_crm_membership_terms WHERE site_id=? AND id=?`,
  'volunteer-profiles': `SELECT constituent_id AS id FROM vc_crm_volunteer_profiles WHERE site_id=? AND constituent_id=?`,
  'volunteer-activities': `SELECT id FROM vc_crm_volunteer_activities WHERE site_id=? AND id=?`,
  'volunteer-participation': `SELECT p.id FROM vc_crm_volunteer_participation p JOIN vc_crm_volunteer_activities a ON a.id=p.activity_id WHERE a.site_id=? AND p.id=?`,
  'volunteer-hours': `SELECT p.id FROM vc_crm_volunteer_hours p JOIN vc_crm_volunteer_activities a ON a.id=p.activity_id WHERE a.site_id=? AND p.id=?`,
} as const
export function importedRecordExistsV1(domain: string, site: string, id: string) {
  return Object.entries(importRecordQueriesV1)
    .map(([key, sql]) => {
      let index = 0
      const query = sql.replace(/\?/g, () => (++index === 1 ? site : id))
      return `(${domain}='${key}' AND EXISTS(${query}))`
    })
    .join(' OR ')
}
