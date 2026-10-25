import { crmRecordRulesV1 } from './record-context-v1'
export function crmTaskRecordRevisionV1(site: string, type: string, id: string) {
  return `CASE ${type} ${Object.entries(crmRecordRulesV1)
    .map(
      ([kind, rule]) =>
        `WHEN '${kind}' THEN(SELECT revision FROM(${rule.sql.replace('?', site).replace('?', id)}))`,
    )
    .join(' ')} END`
}
/** Frozen SQL metadata, never supplied by a request. The live view checks record
 * availability in the same SELECT as native Tasks pagination/count/search. */
export function crmTaskRecordExistsV1(site: string, type: string, id: string) {
  return Object.entries(crmRecordRulesV1)
    .map(([kind, rule]) => {
      const sql = rule.sql.replace('?', site).replace('?', id)
      const coverage =
        kind === 'membership'
          ? ` AND EXISTS(SELECT 1 FROM vc_crm_membership_terms term JOIN vc_crm_affiliations affiliation ON affiliation.constituent_id=term.billing_contact_id AND affiliation.site_id=term.site_id AND affiliation.archived=0 JOIN vc_crm_constituents constituent ON constituent.id=affiliation.constituent_id AND constituent.archived=0 WHERE term.id=${id} AND term.site_id=${site}) AND NOT EXISTS(SELECT 1 FROM vc_crm_membership_coverage coverage JOIN vc_crm_membership_terms term ON term.id=coverage.term_id WHERE term.id=${id} AND NOT EXISTS(SELECT 1 FROM vc_crm_affiliations affiliation JOIN vc_crm_constituents constituent ON constituent.id=affiliation.constituent_id AND constituent.archived=0 WHERE affiliation.site_id=${site} AND affiliation.constituent_id=coverage.constituent_id AND affiliation.archived=0))`
          : ''
      return `(${type}='${kind}' AND EXISTS(${sql})${coverage})`
    })
    .join(' OR ')
}
export const crmTaskContextViewV1 = `CREATE VIEW IF NOT EXISTS vc_crm_task_contexts AS
  SELECT CAST(t.id AS TEXT) AS id,t.id AS task_id,t.crm_site AS site,
    CASE t.crm_type ${Object.entries(crmRecordRulesV1)
      .map(([kind, rule]) => `WHEN '${kind}' THEN '${rule.category}'`)
      .join(' ')} END AS category
  FROM review_tasks t JOIN vc_sites s ON s.id=t.crm_site
  WHERE t.crm_type IS NOT NULL AND s.archived=0 AND (${crmTaskRecordExistsV1('t.crm_site', 't.crm_type', 't.crm_i_d')})`

export const crmTaskConstituentsViewV1 = `CREATE VIEW IF NOT EXISTS vc_crm_task_constituents AS
  SELECT CAST(t.id AS TEXT)||':'||c.id AS id,t.id AS task_id,c.id AS constituent
  FROM review_tasks t JOIN vc_crm_task_contexts context ON context.task_id=t.id
  JOIN vc_crm_affiliations a ON a.site_id=t.crm_site AND a.archived=0
  JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.organization_id=a.organization_id AND c.archived=0
  WHERE (t.crm_type='contact' AND t.crm_i_d=c.id)
    OR(t.crm_type='household' AND EXISTS(SELECT 1 FROM vc_crm_household_members m WHERE m.household_id=t.crm_i_d AND m.constituent_id=c.id AND m.started_on<=substr(t.created_at,1,10) AND(m.ended_on IS NULL OR m.ended_on>=substr(t.created_at,1,10))))
    OR(t.crm_type='gift' AND EXISTS(SELECT 1 FROM vc_crm_gifts g WHERE g.id=t.crm_i_d AND g.site_id=t.crm_site AND g.constituent_id=c.id))
    OR(t.crm_type IN('pledge','recurring') AND EXISTS(SELECT 1 FROM vc_crm_commitments g WHERE g.id=t.crm_i_d AND g.site_id=t.crm_site AND g.constituent_id=c.id AND g.kind=t.crm_type))
    OR(t.crm_type='membership' AND EXISTS(SELECT 1 FROM vc_crm_membership_terms m WHERE m.id=t.crm_i_d AND m.site_id=t.crm_site AND(m.person_id=c.id OR m.billing_contact_id=c.id OR EXISTS(SELECT 1 FROM vc_crm_membership_coverage covered WHERE covered.term_id=m.id AND covered.constituent_id=c.id))))
    OR(t.crm_type='opportunity' AND EXISTS(SELECT 1 FROM vc_crm_opportunities o WHERE o.id=t.crm_i_d AND o.site_id=t.crm_site AND o.constituent_id=c.id))
    OR(t.crm_type='volunteer-activity' AND EXISTS(SELECT 1 FROM vc_crm_volunteer_participation p WHERE p.activity_id=t.crm_i_d AND p.constituent_id=c.id))`
