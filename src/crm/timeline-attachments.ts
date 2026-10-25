import type { InformationCategory } from '../organizations/policy'
import { crmRecordRulesV1 } from './record-context-v1'
import type { CRMRecordType } from './record-model'

/** Contact history may reveal a filename only when its parent is still resolvable.
 * Association is chapter-local and historical; multiple member/participation rows
 * must not multiply the immutable file events.
 */
export function timelineAttachmentSources(read: Set<InformationCategory>) {
  if (!read.has('communications')) return { sources: [], params: [] }
  const categories = [
    'communications',
    'finances',
    'memberships',
    'volunteer-experience',
    'volunteer-hours',
    'restricted-activity',
  ].filter((category) => read.has(category as InformationCategory))
  const associations: Record<CRMRecordType, string> = {
    contact: 'f.record_id=q.contact_id',
    household: `EXISTS(SELECT 1 FROM vc_crm_household_members m WHERE m.household_id=f.record_id AND m.constituent_id=q.contact_id)`,
    gift: `EXISTS(SELECT 1 FROM vc_crm_gifts g WHERE g.id=f.record_id AND g.site_id=q.site_id AND g.constituent_id=q.contact_id)`,
    pledge: `EXISTS(SELECT 1 FROM vc_crm_commitments g WHERE g.id=f.record_id AND g.site_id=q.site_id AND g.constituent_id=q.contact_id AND g.kind='pledge')`,
    recurring: `EXISTS(SELECT 1 FROM vc_crm_commitments g WHERE g.id=f.record_id AND g.site_id=q.site_id AND g.constituent_id=q.contact_id AND g.kind='recurring')`,
    membership: `EXISTS(SELECT 1 FROM vc_crm_membership_coverage m WHERE m.term_id=f.record_id AND m.constituent_id=q.contact_id)`,
    opportunity: `EXISTS(SELECT 1 FROM vc_crm_opportunities g WHERE g.id=f.record_id AND g.site_id=q.site_id AND g.constituent_id=q.contact_id)`,
    'volunteer-activity': `(EXISTS(SELECT 1 FROM vc_crm_volunteer_participation p WHERE p.activity_id=f.record_id AND p.constituent_id=q.contact_id)
      OR EXISTS(SELECT 1 FROM vc_crm_volunteer_invitations p WHERE p.activity_id=f.record_id AND p.constituent_id=q.contact_id)
      ${read.has('volunteer-hours') ? 'OR EXISTS(SELECT 1 FROM vc_crm_volunteer_hours p WHERE p.activity_id=f.record_id AND p.constituent_id=q.contact_id)' : ''})`,
  }
  const sources: string[] = [],
    params: string[] = []
  for (const [rawType, association] of Object.entries(associations)) {
    const type = rawType as CRMRecordType,
      rule = crmRecordRulesV1[type]
    if (!read.has(rule.category)) continue
    let binding = 0
    const parent = rule.sql.replace(/\?/g, () => (++binding === 1 ? 'f.site_id' : 'f.record_id'))
    if (binding !== 2) throw new Error('Timeline parent context requires two bindings.')
    sources.push(`SELECT 'attachment:'||e.id,e.created_at,'attachments','Private attachment '||e.action,f.filename,NULL,NULL,
      '${type === 'contact' ? 'attachment' : type}',${type === 'contact' ? 'f.id' : 'f.record_id'},NULL,NULL,NULL,NULL
      FROM vc_crm_attachment_events e JOIN vc_crm_attachments f ON f.id=e.attachment_id CROSS JOIN chosen q
      WHERE f.site_id=q.site_id AND f.record_type='${type}' AND (${association})
      AND EXISTS(${parent}) AND (f.ready_at IS NOT NULL OR f.created_by=q.actor_id)
      AND f.category IN(${categories.map(() => '?').join(',')})`)
    params.push(...categories)
  }
  return { sources, params }
}
