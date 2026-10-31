import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { authorizeCRMTaskActor } from './task-access'
import { crmRecordLink, type CRMRecordType } from './record-model'
import { crmRecordRulesV3 } from './record-context-v3'

const sources: Record<CRMRecordType, string> = {
  contact: `SELECT c.id,c.label FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=? AND a.archived=0 WHERE c.archived=0`,
  household: `SELECT id,name AS label FROM vc_crm_households WHERE site_id=?`,
  gift: `SELECT id,coalesce(nullif(reference,''),'Gift '||received_on) AS label FROM vc_crm_gifts WHERE site_id=?`,
  pledge: `SELECT id,name AS label FROM vc_crm_commitments WHERE site_id=? AND kind='pledge'`,
  recurring: `SELECT id,name AS label FROM vc_crm_commitments WHERE site_id=? AND kind='recurring'`,
  membership: `SELECT t.id,coalesce(c.label,h.name) AS label FROM vc_crm_membership_terms t LEFT JOIN vc_crm_constituents c ON c.id=t.person_id LEFT JOIN vc_crm_households h ON h.id=t.household_id WHERE t.site_id=?`,
  opportunity: `SELECT id,name AS label FROM vc_crm_opportunities WHERE site_id=?`,
  'volunteer-activity': `SELECT id,name AS label FROM vc_crm_volunteer_activities WHERE site_id=? AND archived=0`,
  campaign: `SELECT id,name AS label FROM vc_crm_campaigns WHERE site_id=?`,
  appeal: `SELECT id,name AS label FROM vc_crm_appeals WHERE site_id=?`,
  fund: `SELECT id,name AS label FROM vc_crm_funds WHERE site_id=? AND archived=0`,
  'volunteer-invitation': `SELECT i.id,a.name||' invitation' AS label FROM vc_crm_volunteer_invitations i JOIN vc_crm_volunteer_activities a ON a.id=i.activity_id WHERE a.site_id=?`,
  'volunteer-participation': `SELECT p.id,a.name||' participation' AS label FROM vc_crm_volunteer_participation p JOIN vc_crm_volunteer_activities a ON a.id=p.activity_id WHERE a.site_id=?`,
  'volunteer-hours': `SELECT h.id,a.name||' hours' AS label FROM vc_crm_volunteer_hours h JOIN vc_crm_volunteer_activities a ON a.id=h.activity_id WHERE a.site_id=?`,
  'correspondence-document': `SELECT id,subject AS label FROM vc_crm_documents WHERE site_id=?`,
  'correspondence-batch': `SELECT id,name AS label FROM vc_crm_correspondence_batches WHERE site_id=?`,
  'import-run': `SELECT id,name AS label FROM vc_crm_import_runs WHERE site_id=?`,
}

export async function crmTaskRecordPicker(db: D1Database, actor: number, site: string, type: unknown, search: unknown) {
  const link = crmRecordLink(type, 'picker')
  if (typeof search !== 'string' || search.length > 80) throw new Error('Enter a shorter record search.')
  const authority = new OrganizationRepository(db, actor)
  await authority.require(site, 'workspace', 'edit')
  if (link.type !== 'import-run') await authority.require(site, crmRecordRulesV3[link.type].category, 'edit')
  await authority.require(site, 'identity', 'read')
  const candidates = await db.prepare(`SELECT id,label FROM (${sources[link.type]}) WHERE instr(lower(label),lower(?))>0 ORDER BY label,id LIMIT 80`)
    .bind(site, search.trim()).all<{ id: string; label: string }>()
  const docs: Array<{ id: string; label: string; revision: number; authorityRevision: number }> = []
  for (const row of candidates.results) {
    try {
      const access = await authorizeCRMTaskActor(db, actor, site, { type: link.type, id: row.id }, 'edit')
      docs.push({ id: row.id, label: row.label, revision: access.record.revision, authorityRevision: access.site.authorityRevision })
      if (docs.length === 20) break
    } catch (error) {
      if (!(error instanceof SiteAccessError)) throw error
    }
  }
  return { docs }
}
