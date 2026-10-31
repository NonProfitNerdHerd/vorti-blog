import { crmRecordRulesV2 } from './record-context-v2'
import { crmTaskConstituentsViewV1 } from './task-context-v1'

export function crmTaskRecordExistsV2(site: string, type: string, id: string) {
  return Object.entries(crmRecordRulesV2).map(([kind, rule]) => {
    const sql = rule.sql.replace('?', site).replace('?', id)
    const coverage = kind === 'membership' ? ` AND EXISTS(SELECT 1 FROM vc_crm_membership_terms term JOIN vc_crm_affiliations affiliation ON affiliation.constituent_id=term.billing_contact_id AND affiliation.site_id=term.site_id AND affiliation.archived=0 JOIN vc_crm_constituents constituent ON constituent.id=affiliation.constituent_id AND constituent.archived=0 WHERE term.id=${id} AND term.site_id=${site}) AND NOT EXISTS(SELECT 1 FROM vc_crm_membership_coverage coverage JOIN vc_crm_membership_terms term ON term.id=coverage.term_id WHERE term.id=${id} AND NOT EXISTS(SELECT 1 FROM vc_crm_affiliations affiliation JOIN vc_crm_constituents constituent ON constituent.id=affiliation.constituent_id AND constituent.archived=0 WHERE affiliation.site_id=${site} AND affiliation.constituent_id=coverage.constituent_id AND affiliation.archived=0))` : ''
    return `(${type}='${kind}' AND EXISTS(${sql})${coverage})`
  }).join(' OR ')
}
export function crmTaskRecordRevisionV2(site: string, type: string, id: string) {
  return `CASE ${type} ${Object.entries(crmRecordRulesV2).map(([kind, rule]) => `WHEN '${kind}' THEN(SELECT revision FROM(${rule.sql.replace('?', site).replace('?', id)}))`).join(' ')} END`
}
const valid = crmTaskRecordExistsV2('NEW.crm_site','NEW.crm_type','NEW.crm_i_d')
const context = `NEW.crm_type IS NOT NULL AND (NEW.crm_site IS NULL OR NEW.crm_i_d IS NULL OR NEW.document_site IS NOT NEW.crm_site OR NEW.crm_operation_key IS NULL OR length(NEW.crm_operation_key) NOT BETWEEN 16 AND 128 OR NEW.crm_intent_hash IS NULL OR length(NEW.crm_intent_hash)<>64 OR NOT (${valid}) OR (NEW.crm_activity_i_d IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_activities activity WHERE activity.id=NEW.crm_activity_i_d AND activity.site_id=NEW.crm_site AND activity.constituent_id=NEW.crm_i_d AND NEW.crm_type='contact')))`
export const crmTaskSchemaV2 = [
  `DROP TRIGGER IF EXISTS vc_crm_task_initial_revision`,
  `DROP TRIGGER IF EXISTS vc_crm_task_context_insert`,
  `DROP TRIGGER IF EXISTS vc_crm_task_context_update`,
  `DROP VIEW IF EXISTS vc_crm_task_constituents`,
  `DROP VIEW IF EXISTS vc_crm_task_contexts`,
  `CREATE VIEW vc_crm_task_contexts AS SELECT CAST(t.id AS TEXT) AS id,t.id AS task_id,t.crm_site AS site,CASE t.crm_type ${Object.entries(crmRecordRulesV2).map(([kind, rule]) => `WHEN '${kind}' THEN '${rule.category}'`).join(' ')} END AS category FROM review_tasks t JOIN vc_sites s ON s.id=t.crm_site WHERE t.crm_type IS NOT NULL AND s.archived=0 AND (${crmTaskRecordExistsV2('t.crm_site','t.crm_type','t.crm_i_d')})`,
  crmTaskConstituentsViewV1.replace('CREATE VIEW IF NOT EXISTS','CREATE VIEW'),
  `CREATE TRIGGER vc_crm_task_initial_revision BEFORE INSERT ON review_tasks WHEN NEW.crm_type IS NOT NULL AND (NEW.crm_record_revision IS NOT (${crmTaskRecordRevisionV2('NEW.crm_site','NEW.crm_type','NEW.crm_i_d')}) OR NEW.crm_authority_revision IS NOT(SELECT o.authority_revision FROM vc_sites s JOIN vc_organizations o ON o.id=s.organization_id WHERE s.id=NEW.crm_site)) BEGIN SELECT RAISE(ABORT,'CRM follow-up source or permissions changed'); END`,
  ...['INSERT','UPDATE'].map(event => `CREATE TRIGGER vc_crm_task_context_${event.toLowerCase()} BEFORE ${event} ON review_tasks WHEN (${context}) OR (NEW.crm_type IS NULL AND (NEW.crm_site IS NOT NULL OR NEW.crm_i_d IS NOT NULL OR NEW.crm_activity_i_d IS NOT NULL OR NEW.crm_operation_key IS NOT NULL OR NEW.crm_intent_hash IS NOT NULL OR NEW.crm_record_revision IS NOT NULL OR NEW.crm_authority_revision IS NOT NULL)) OR (NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM review_tasks parent WHERE parent.id=NEW.parent_id AND (parent.crm_site IS NOT NEW.crm_site OR parent.crm_type IS NOT NEW.crm_type OR parent.crm_i_d IS NOT NEW.crm_i_d OR parent.crm_activity_i_d IS NOT NEW.crm_activity_i_d))) BEGIN SELECT RAISE(ABORT,'CRM task requires current retained chapter record context'); END`),
] as const
