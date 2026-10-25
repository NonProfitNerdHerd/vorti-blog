/** Internal preservation SQL only. Expressions are supplied by application
 * metadata, never requests. Includes inactive/history rows; supplies no grant
 * to view their names, content, files, or native Tasks. */
export function mergeRecordMatch(type: string, id: string, site: string): string {
  return `(
    (${type}='contact' AND ${id} IN(?1,?2)) OR
    (${type}='household' AND EXISTS(SELECT 1 FROM vc_crm_households mh WHERE mh.id=${id} AND mh.site_id=${site}
      AND (mh.primary_contact IN(?1,?2) OR EXISTS(SELECT 1 FROM vc_crm_household_members mm WHERE mm.household_id=mh.id AND mm.constituent_id IN(?1,?2))))) OR
    (${type}='gift' AND EXISTS(SELECT 1 FROM vc_crm_gifts mg WHERE mg.id=${id} AND mg.site_id=${site} AND mg.constituent_id IN(?1,?2))) OR
    (${type} IN('pledge','recurring') AND EXISTS(SELECT 1 FROM vc_crm_commitments mc WHERE mc.id=${id} AND mc.site_id=${site} AND mc.constituent_id IN(?1,?2))) OR
    (${type}='membership' AND EXISTS(SELECT 1 FROM vc_crm_membership_terms mt WHERE mt.id=${id} AND mt.site_id=${site}
      AND (mt.person_id IN(?1,?2) OR mt.billing_contact_id IN(?1,?2) OR EXISTS(SELECT 1 FROM vc_crm_membership_coverage mv WHERE mv.term_id=mt.id AND mv.constituent_id IN(?1,?2))))) OR
    (${type}='opportunity' AND EXISTS(SELECT 1 FROM vc_crm_opportunities mo WHERE mo.id=${id} AND mo.site_id=${site} AND mo.constituent_id IN(?1,?2))) OR
    (${type}='volunteer-activity' AND EXISTS(SELECT 1 FROM vc_crm_volunteer_activities ma WHERE ma.id=${id} AND ma.site_id=${site} AND (
      EXISTS(SELECT 1 FROM vc_crm_volunteer_participation mp WHERE mp.activity_id=ma.id AND mp.constituent_id IN(?1,?2)) OR
      EXISTS(SELECT 1 FROM vc_crm_volunteer_invitations mi WHERE mi.activity_id=ma.id AND mi.constituent_id IN(?1,?2)) OR
      EXISTS(SELECT 1 FROM vc_crm_volunteer_hours mh WHERE mh.activity_id=ma.id AND mh.constituent_id IN(?1,?2)))))
  )`
}
