import type { InformationCategory } from '../organizations/policy'
/** Frozen predicates used by migration triggers. Change context through a new migration/version. */
export type CRMRecordTypeV1 =
  | 'contact'
  | 'household'
  | 'gift'
  | 'pledge'
  | 'recurring'
  | 'membership'
  | 'opportunity'
  | 'volunteer-activity'

const contactJoin = `JOIN vc_crm_constituents c ON c.id=r.constituent_id AND c.archived=0
  JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=r.site_id AND a.archived=0`
export const crmRecordRulesV1: Record<
  CRMRecordTypeV1,
  { category: InformationCategory; sql: string }
> = {
  contact: {
    category: 'communications',
    sql: `SELECT c.id,c.label,c.revision FROM vc_crm_constituents c
    JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.archived=0 WHERE a.site_id=? AND c.id=? AND c.archived=0`,
  },
  household: {
    category: 'affiliations',
    sql: 'SELECT id,name AS label,revision FROM vc_crm_households WHERE site_id=? AND id=?',
  },
  gift: {
    category: 'finances',
    sql: `SELECT r.id,coalesce(nullif(r.reference,''),'Gift '||r.received_on) AS label,r.revision
    FROM vc_crm_gifts r ${contactJoin} WHERE r.site_id=? AND r.id=?`,
  },
  pledge: {
    category: 'finances',
    sql: `SELECT r.id,r.name AS label,r.revision FROM vc_crm_commitments r ${contactJoin}
    WHERE r.site_id=? AND r.id=? AND r.kind='pledge'`,
  },
  recurring: {
    category: 'finances',
    sql: `SELECT r.id,r.name AS label,r.revision FROM vc_crm_commitments r ${contactJoin}
    WHERE r.site_id=? AND r.id=? AND r.kind='recurring'`,
  },
  membership: {
    category: 'memberships',
    sql: `SELECT t.id,coalesce(c.label,h.name) AS label,t.revision
    FROM vc_crm_membership_terms t LEFT JOIN vc_crm_constituents c ON c.id=t.person_id
    LEFT JOIN vc_crm_households h ON h.id=t.household_id AND h.site_id=t.site_id
    WHERE t.site_id=? AND t.id=? AND ((t.person_id IS NOT NULL AND c.archived=0 AND EXISTS(
      SELECT 1 FROM vc_crm_affiliations a WHERE a.constituent_id=t.person_id AND a.site_id=t.site_id AND a.archived=0)
      AND EXISTS(SELECT 1 FROM vc_crm_membership_coverage m WHERE m.term_id=t.id AND m.constituent_id=t.person_id))
      OR (t.household_id IS NOT NULL AND h.id IS NOT NULL))`,
  },
  opportunity: {
    category: 'restricted-activity',
    sql: `SELECT r.id,r.name AS label,r.revision FROM vc_crm_opportunities r
    ${contactJoin} WHERE r.site_id=? AND r.id=?`,
  },
  'volunteer-activity': {
    category: 'restricted-activity',
    sql: 'SELECT id,name AS label,revision FROM vc_crm_volunteer_activities WHERE site_id=? AND id=?',
  },
}
