import { crmRecordRulesV2 } from './record-context-v2'

/** Additional retained sources. Earlier migration predicates remain frozen. */
export const crmRecordRulesV3 = {
  ...crmRecordRulesV2,
  fund: { category: 'finances' as const, sql: 'SELECT id,name AS label,revision FROM vc_crm_funds WHERE site_id=? AND id=? AND archived=0' },
  'volunteer-invitation': { category: 'volunteer-experience' as const, sql: `SELECT i.id,a.name AS label,i.revision FROM vc_crm_volunteer_invitations i JOIN vc_crm_volunteer_activities a ON a.id=i.activity_id JOIN vc_crm_affiliations f ON f.site_id=a.site_id AND f.constituent_id=i.constituent_id AND f.archived=0 WHERE a.site_id=? AND i.id=?` },
  'volunteer-participation': { category: 'volunteer-experience' as const, sql: `SELECT p.id,a.name AS label,p.revision FROM vc_crm_volunteer_participation p JOIN vc_crm_volunteer_activities a ON a.id=p.activity_id JOIN vc_crm_affiliations f ON f.site_id=a.site_id AND f.constituent_id=p.constituent_id AND f.archived=0 WHERE a.site_id=? AND p.id=?` },
  'volunteer-hours': { category: 'volunteer-hours' as const, sql: `SELECT h.id,a.name AS label,h.revision FROM vc_crm_volunteer_hours h JOIN vc_crm_volunteer_activities a ON a.id=h.activity_id JOIN vc_crm_affiliations f ON f.site_id=a.site_id AND f.constituent_id=h.constituent_id AND f.archived=0 WHERE a.site_id=? AND h.id=?` },
  'correspondence-document': { category: 'communications' as const, sql: `SELECT d.id,d.subject AS label,1 AS revision FROM vc_crm_documents d JOIN vc_crm_affiliations f ON f.site_id=d.site_id AND f.constituent_id=d.constituent_id AND f.archived=0 WHERE d.site_id=? AND d.id=? AND NOT EXISTS(SELECT 1 FROM vc_crm_documents next WHERE next.supersedes_id=d.id)` },
  'correspondence-batch': { category: 'communications' as const, sql: 'SELECT id,name AS label,revision FROM vc_crm_correspondence_batches WHERE site_id=? AND id=?' },
  'import-run': { category: 'reports' as const, sql: 'SELECT id,name AS label,revision FROM vc_crm_import_runs WHERE site_id=? AND id=?' },
}
