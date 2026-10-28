import type { InformationCategory } from '../organizations/policy'
import type { TimelineGroup } from './timeline-model'
import { timelineAttachmentSources } from './timeline-attachments'
import { timelineTaskSources } from './timeline-tasks'

type Source = { group: TimelineGroup; sql: string }
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
/** Only server-authored SQL fragments enter this builder. Site/contact/cursors remain bound values. */
export function timelineSources(read: Set<InformationCategory>, withTasks = false) {
  const sources: Source[] = [],
    params: string[] = []
  const add = (group: TimelineGroup, sql: string) => sources.push({ group, sql })
  const audit = (
    group: TimelineGroup,
    type: string,
    join: string,
    where: string,
    titles: Record<string, string>,
    label: string,
    effective = 'NULL',
  ) => {
    const actions = Object.entries(titles)
    add(
      group,
      `SELECT 'audit:'||p.id AS id,p.created_at AS at,${quote(group)} AS kind,
      CASE p.action ${actions.map(([action, title]) => `WHEN ${quote(action)} THEN ${quote(title)}`).join(' ')} END AS title,
      ${label} AS label,NULL AS detail,${effective} AS effective_on,${quote(type)} AS target_type,p.record_id AS target_id,
      NULL AS minor,NULL AS currency,NULL AS exponent,NULL AS money_role
      FROM vc_platform_audit p CROSS JOIN chosen q ${join} WHERE p.site_id=q.site_id AND p.record_type=${quote(type)}
      AND p.action IN(${actions.map(([action]) => quote(action)).join(',')}) AND (${where})`,
    )
  }
  audit(
    'profile',
    'constituent',
    'JOIN vc_crm_constituents c ON c.id=p.record_id',
    'c.id=q.contact_id',
    {
      'contact.created': 'Constituent recorded',
      'contact.profile.updated': 'Shared profile updated',
      'contact.chapter.updated': 'Chapter details updated',
      'contact.correction.requested': 'Identity correction requested',
      'contact.correction.reviewed': 'Identity correction reviewed',
    },
    'c.label',
  )
  add(
    'profile',
    `SELECT 'affiliation:'||a.id,a.created_at,'profile','Chapter affiliation recorded',c.label,NULL,NULL,'contact',c.id,NULL,NULL,NULL,NULL
    FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id CROSS JOIN chosen q
    WHERE a.site_id=q.site_id AND a.constituent_id=q.contact_id AND a.archived=0 AND c.archived=0`,
  )
  if (read.has('communications'))
    audit(
      'communications',
      'communication',
      'JOIN vc_crm_activities r ON r.id=p.record_id',
      'r.site_id=q.site_id AND r.constituent_id=q.contact_id',
      { 'activity.created': 'Communication recorded', 'activity.updated': 'Communication updated' },
      "coalesce(json_extract(p.after_value,'$.subject'),r.subject)",
      "json_extract(p.after_value,'$.occurredOn')",
    )
  if (read.has('communications'))
    add('comments', `SELECT 'audit:'||p.id,p.created_at,'comments',
      CASE p.action WHEN 'comment.created' THEN 'Comment added' ELSE 'Comment edited' END,
      r.author_label,json_extract(p.after_value,'$.body'),NULL,'contact-comment',r.id,
      NULL,NULL,NULL,NULL
      FROM vc_platform_audit p JOIN vc_crm_comments r ON r.id=p.record_id CROSS JOIN chosen q
      WHERE p.site_id=q.site_id AND p.record_type='contact-comment'
      AND p.action IN('comment.created','comment.updated')
      AND r.site_id=q.site_id AND r.constituent_id=q.contact_id`)
  if (read.has('affiliations')) {
    audit(
      'relationships',
      'households',
      'JOIN vc_crm_households h ON h.id=p.record_id',
      `h.site_id=q.site_id AND ((p.action='add-member' AND json_extract(p.after_value,'$.constituent')=q.contact_id)
      OR (p.action='end-member' AND EXISTS(SELECT 1 FROM vc_crm_household_members m WHERE m.household_id=h.id AND m.id=json_extract(p.after_value,'$.member') AND m.constituent_id=q.contact_id))
      OR (p.action='update-household' AND EXISTS(SELECT 1 FROM vc_crm_household_members m WHERE m.household_id=h.id AND m.constituent_id=q.contact_id)))`,
      {
        'add-member': 'Household member added',
        'end-member': 'Household membership ended',
        'update-household': 'Household updated',
      },
      'h.name',
      "coalesce(json_extract(p.after_value,'$.startedOn'),json_extract(p.after_value,'$.endedOn'))",
    )
    audit(
      'relationships',
      'households',
      `JOIN vc_crm_relationships r ON r.id=p.record_id
      JOIN vc_crm_relationship_types t ON t.id=r.type_id AND t.site_id=r.site_id
      JOIN vc_crm_constituents other ON other.id=CASE WHEN r.source_id=q.contact_id THEN r.target_id ELSE r.source_id END AND other.archived=0
      JOIN vc_crm_affiliations f ON f.constituent_id=other.id AND f.site_id=r.site_id AND f.archived=0`,
      'r.site_id=q.site_id AND (r.source_id=q.contact_id OR r.target_id=q.contact_id)',
      {
        'create-relationship': 'Relationship recorded',
        'update-relationship': 'Relationship updated',
      },
      "(CASE WHEN r.source_id=q.contact_id THEN t.label ELSE t.reciprocal_label END)||' · '||other.label",
      "json_extract(p.after_value,'$.start')",
    )
  }
  if (read.has('finances')) {
    add(
      'giving',
      `SELECT 'gift:'||g.id,g.created_at,'giving',CASE WHEN g.kind='in-kind' THEN 'In-kind gift recorded' ELSE 'Gift recorded' END,
      coalesce(nullif(g.reference,''),'Recorded gift'),NULL,g.received_on,'gift',g.id,
      CASE WHEN g.kind='in-kind' THEN NULL ELSE g.original_minor END,g.currency,g.exponent,'received-gift'
      FROM vc_crm_gifts g CROSS JOIN chosen q WHERE g.site_id=q.site_id AND g.constituent_id=q.contact_id`,
    )
    add(
      'giving',
      `SELECT 'adjustment:'||a.id,a.created_at,'giving',CASE a.action WHEN 'refund' THEN 'Gift refunded' WHEN 'void' THEN 'Gift voided' ELSE 'Gift correction recorded' END,
      coalesce(nullif(g.reference,''),'Recorded gift'),a.reason,NULL,'gift',g.id,
      CASE WHEN g.kind='in-kind' OR a.action='void' THEN NULL ELSE a.delta_minor END,g.currency,g.exponent,'gift-adjustment'
      FROM vc_crm_gift_adjustments a JOIN vc_crm_gifts g ON g.id=a.gift_id CROSS JOIN chosen q WHERE g.site_id=q.site_id AND g.constituent_id=q.contact_id`,
    )
    add(
      'giving',
      `SELECT 'giving:'||r.id,r.created_at,'giving',CASE r.kind WHEN 'pledge' THEN 'Commitment recorded' ELSE 'Recurring schedule recorded' END,
      r.name,CASE r.kind WHEN 'recurring' THEN 'Frequency: '||r.frequency ELSE NULL END,r.starts_on,r.kind,r.id,
      r.amount_minor,r.currency,r.exponent,CASE r.kind WHEN 'pledge' THEN 'pledge' ELSE 'recurring-installment' END
      FROM vc_crm_commitments r CROSS JOIN chosen q WHERE r.site_id=q.site_id AND r.constituent_id=q.contact_id`,
    )
    audit(
      'giving',
      'giving',
      'JOIN vc_crm_commitments r ON r.id=p.record_id',
      'r.site_id=q.site_id AND r.constituent_id=q.contact_id',
      {
        'giving.changed': 'Commitment or schedule changed',
        'giving.payment-applied': 'Recorded gift applied to commitment',
        'giving.payment-reversed': 'Gift application reversed',
      },
      'r.name',
      "json_extract(p.after_value,'$.effectiveOn')",
    )
  }
  if (read.has('memberships'))
    audit(
      'memberships',
      'membership',
      'JOIN vc_crm_membership_terms r ON r.id=p.record_id',
      'r.site_id=q.site_id AND EXISTS(SELECT 1 FROM vc_crm_membership_coverage c WHERE c.term_id=r.id AND c.constituent_id=q.contact_id)',
      {
        'membership.enrolled': 'Membership term recorded',
        'membership.cancelled': 'Membership cancelled',
      },
      'r.type_name',
      "coalesce(json_extract(p.after_value,'$.effectiveOn'),r.starts_on)",
    )
  if (read.has('restricted-activity')) {
    audit(
      'opportunities',
      'opportunity',
      'JOIN vc_crm_opportunities r ON r.id=p.record_id',
      'r.site_id=q.site_id AND r.constituent_id=q.contact_id',
      {
        'opportunity.created': 'Opportunity recorded',
        'opportunity.updated': 'Opportunity updated',
      },
      "coalesce(json_extract(p.after_value,'$.name'),r.name)",
    )
    add(
      'opportunities',
      `SELECT 'opportunity-stage:'||h.id,h.created_at,'opportunities','Opportunity stage recorded',h.to_label,h.reason,NULL,'opportunity',r.id,NULL,NULL,NULL,NULL
      FROM vc_crm_opportunity_stage_history h JOIN vc_crm_opportunities r ON r.id=h.opportunity_id CROSS JOIN chosen q WHERE r.site_id=q.site_id AND r.constituent_id=q.contact_id`,
    )
    if (read.has('finances'))
      audit(
        'opportunities',
        'opportunity',
        'JOIN vc_crm_opportunities r ON r.id=p.record_id',
        'r.site_id=q.site_id AND r.constituent_id=q.contact_id',
        {
          'opportunity.link.created': 'Financial record explicitly linked',
          'opportunity.link.removed': 'Financial link removed',
        },
        'r.name',
      )
    audit(
      'volunteers',
      'volunteer-participation',
      `JOIN vc_crm_volunteer_participation r ON r.id=p.record_id JOIN vc_crm_volunteer_activities a ON a.id=r.activity_id`,
      'a.site_id=q.site_id AND r.constituent_id=q.contact_id',
      {
        'volunteer.participation.created': 'Volunteer participation recorded',
        'volunteer.participation.updated': 'Volunteer participation updated',
      },
      'a.name',
    )
    if (read.has('volunteer-hours'))
      audit(
        'volunteers',
        'volunteer-hours',
        `JOIN vc_crm_volunteer_hours r ON r.id=p.record_id JOIN vc_crm_volunteer_activities a ON a.id=r.activity_id`,
        'a.site_id=q.site_id AND r.constituent_id=q.contact_id',
        {
          'volunteer.hours.submitted': 'Volunteer hours submitted',
          'volunteer.hours.reviewed': 'Volunteer hours reviewed',
        },
        'a.name',
        'r.occurred_on',
      )
    if (read.has('communications'))
      audit(
        'volunteers',
        'volunteer-invitation',
        `JOIN vc_crm_volunteer_invitations r ON r.id=p.record_id JOIN vc_crm_volunteer_activities a ON a.id=r.activity_id`,
        'a.site_id=q.site_id AND r.constituent_id=q.contact_id',
        {
          'volunteer.invitation.recorded': 'Volunteer outreach recorded',
          'volunteer.invitation.response': 'Volunteer response recorded',
        },
        'a.name',
        'r.occurred_on',
      )
  }
  if (read.has('volunteer-experience'))
    audit(
      'volunteers',
      'volunteer-profile',
      'JOIN vc_crm_volunteer_profiles r ON r.constituent_id=p.record_id AND r.site_id=p.site_id',
      'r.site_id=q.site_id AND r.constituent_id=q.contact_id',
      {
        'volunteer.profile.created': 'Volunteer profile recorded',
        'volunteer.profile.updated': 'Volunteer profile updated',
      },
      "'Skills, interests and contact preferences'",
    )
  if (read.has('communications')) {
    const financial = read.has('finances') ? '1' : '0',
      membership = read.has('memberships') ? '1' : '0'
    const documentWhere = `d.site_id=q.site_id AND d.constituent_id=q.contact_id AND (d.financial=0 OR ${financial}=1) AND (d.membership=0 OR ${membership}=1)`
    add(
      'correspondence',
      `SELECT 'document:'||d.id,d.created_at,'correspondence',CASE WHEN d.supersedes_id IS NULL THEN 'Document issued' ELSE 'Corrected document issued' END,
      d.subject,NULL,d.issued_on,'correspondence',d.id,NULL,NULL,NULL,NULL FROM vc_crm_documents d CROSS JOIN chosen q WHERE ${documentWhere}`,
    )
    add(
      'correspondence',
      `SELECT 'email:'||e.id,e.created_at,'correspondence','Email delivery event',d.subject,e.event,NULL,'correspondence',d.id,NULL,NULL,NULL,NULL
      FROM vc_crm_email_events e JOIN vc_crm_email_outbox o ON o.id=e.outbox_id JOIN vc_crm_documents d ON d.id=o.document_id AND d.site_id=o.site_id CROSS JOIN chosen q WHERE ${documentWhere}`,
    )
  }
  const attachments = timelineAttachmentSources(read)
  for (const sql of attachments.sources) add('attachments', sql)
  params.push(...attachments.params)
  if (withTasks) {
    const tasks = timelineTaskSources(read)
    for (const sql of tasks.sources) add('tasks', sql)
    params.push(...tasks.params)
  }
  return { sources, params }
}
