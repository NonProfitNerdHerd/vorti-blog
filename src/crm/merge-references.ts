/** Internal preservation inventory, NOT a staff authorization/query API.
 * Before exposing any row/count, the merge service must enforce chapter/domain
 * access and native Task audiences. Raw rows include private historical data.
 * All SQL metadata below is application-owned; requests never supply SQL. */
import { mergeRecordMatch } from './merge-record-match'

type Rule = {
  table: string
  columns: readonly string[]
  from: string
  site: string
  match: string
  key?: string
}
const direct = (
  table: string,
  columns: string[],
  site = 'r.site_id',
  from = `${table} r`,
  key?: string,
): Rule => ({
  table,
  columns,
  site,
  from,
  key,
  match: columns.map((column) => `r.${column} IN(?1,?2)`).join(' OR '),
})
export const mergeReferenceRules = {
  affiliations: direct('vc_crm_affiliations', ['constituent_id']),
  corrections: direct('vc_crm_corrections', ['constituent_id']),
  'household-primary': direct('vc_crm_households', ['primary_contact']),
  'household-members': direct(
    'vc_crm_household_members',
    ['constituent_id'],
    'h.site_id',
    'vc_crm_household_members r JOIN vc_crm_households h ON h.id=r.household_id',
  ),
  relationships: direct('vc_crm_relationships', ['source_id', 'target_id']),
  gifts: direct('vc_crm_gifts', ['constituent_id']),
  commitments: direct('vc_crm_commitments', ['constituent_id']),
  memberships: direct('vc_crm_membership_terms', ['person_id', 'billing_contact_id']),
  'membership-coverage': direct(
    'vc_crm_membership_coverage',
    ['constituent_id'],
    't.site_id',
    'vc_crm_membership_coverage r JOIN vc_crm_membership_terms t ON t.id=r.term_id',
    'json_array(r.term_id,r.constituent_id)',
  ),
  'volunteer-profiles': direct(
    'vc_crm_volunteer_profiles',
    ['constituent_id'],
    'r.site_id',
    'vc_crm_volunteer_profiles r',
    'json_array(r.site_id,r.constituent_id)',
  ),
  'volunteer-participation': direct(
    'vc_crm_volunteer_participation',
    ['constituent_id'],
    'a.site_id',
    'vc_crm_volunteer_participation r JOIN vc_crm_volunteer_activities a ON a.id=r.activity_id',
  ),
  'volunteer-invitations': direct(
    'vc_crm_volunteer_invitations',
    ['constituent_id'],
    'a.site_id',
    'vc_crm_volunteer_invitations r JOIN vc_crm_volunteer_activities a ON a.id=r.activity_id',
  ),
  'volunteer-hours': direct(
    'vc_crm_volunteer_hours',
    ['constituent_id'],
    'a.site_id',
    'vc_crm_volunteer_hours r JOIN vc_crm_volunteer_activities a ON a.id=r.activity_id',
  ),
  communications: direct('vc_crm_activities', ['constituent_id']),
  opportunities: direct('vc_crm_opportunities', ['constituent_id']),
  documents: direct('vc_crm_documents', ['constituent_id']),
  outbox: direct('vc_crm_email_outbox', ['constituent_id']),
  'gift-adjustments': {
    table: 'vc_crm_gift_adjustments',
    columns: [] as const,
    site: 'g.site_id',
    from: 'vc_crm_gift_adjustments r JOIN vc_crm_gifts g ON g.id=r.gift_id',
    match: 'g.constituent_id IN(?1,?2)',
  },
  'membership-term-coverage': {
    table: 'vc_crm_membership_coverage',
    columns: [] as const,
    site: 't.site_id',
    key: 'json_array(r.term_id,r.constituent_id)',
    from: 'vc_crm_membership_coverage r JOIN vc_crm_membership_terms t ON t.id=r.term_id',
    match: 't.person_id IN(?1,?2) OR t.billing_contact_id IN(?1,?2)',
  },
  installments: {
    table: 'vc_crm_pledge_installments',
    columns: [] as const,
    site: 'c.site_id',
    from: 'vc_crm_pledge_installments r JOIN vc_crm_commitments c ON c.id=r.commitment_id',
    match: 'c.constituent_id IN(?1,?2)',
  },
  pauses: {
    table: 'vc_crm_giving_pauses',
    columns: [] as const,
    site: 'c.site_id',
    from: 'vc_crm_giving_pauses r JOIN vc_crm_commitments c ON c.id=r.commitment_id',
    match: 'c.constituent_id IN(?1,?2)',
  },
  applications: {
    table: 'vc_crm_giving_applications',
    columns: [] as const,
    site: 'c.site_id',
    from: 'vc_crm_giving_applications r JOIN vc_crm_commitments c ON c.id=r.commitment_id JOIN vc_crm_gifts g ON g.id=r.gift_id',
    match: 'c.constituent_id IN(?1,?2) OR g.constituent_id IN(?1,?2)',
  },
  'opportunity-stage-history': {
    table: 'vc_crm_opportunity_stage_history',
    columns: [] as const,
    site: 'o.site_id',
    from: 'vc_crm_opportunity_stage_history r JOIN vc_crm_opportunities o ON o.id=r.opportunity_id',
    match: 'o.constituent_id IN(?1,?2)',
  },
  'opportunity-links': {
    table: 'vc_crm_opportunity_links',
    columns: [] as const,
    site: 'o.site_id',
    from: 'vc_crm_opportunity_links r JOIN vc_crm_opportunities o ON o.id=r.opportunity_id',
    match: 'o.constituent_id IN(?1,?2)',
  },
  'document-files': {
    table: 'vc_crm_document_files',
    columns: [] as const,
    site: 'd.site_id',
    key: 'r.document_id',
    from: 'vc_crm_document_files r JOIN vc_crm_documents d ON d.id=r.document_id',
    match: 'd.constituent_id IN(?1,?2)',
  },
  'email-events': {
    table: 'vc_crm_email_events',
    columns: [] as const,
    site: 'o.site_id',
    from: 'vc_crm_email_events r JOIN vc_crm_email_outbox o ON o.id=r.outbox_id',
    match: 'o.constituent_id IN(?1,?2)',
  },
  'contact-source-identifiers': {
    table: 'vc_crm_source_identifiers',
    columns: [] as const,
    site: 'r.site_id',
    key: 'json_array(r.organization_id,r.site_id,r.domain,r.platform,r.external_id)',
    from: 'vc_crm_source_identifiers r',
    match: "r.domain IN('contacts','volunteer-profiles') AND r.record_id IN(?1,?2)",
  },
  attachments: {
    table: 'vc_crm_attachments',
    columns: [] as const,
    site: 'r.site_id',
    from: 'vc_crm_attachments r',
    match: mergeRecordMatch('r.record_type', 'r.record_id', 'r.site_id'),
  },
  'attachment-events': {
    table: 'vc_crm_attachment_events',
    columns: [] as const,
    site: 'a.site_id',
    from: 'vc_crm_attachment_events r JOIN vc_crm_attachments a ON a.id=r.attachment_id',
    match: mergeRecordMatch('a.record_type', 'a.record_id', 'a.site_id'),
  },
} satisfies Record<string, Rule>
export type MergeReferenceKind = keyof typeof mergeReferenceRules

/** Bounded keyset reads include archived history and never rewrite attribution.
 * This is an internal building block: actor authorization, approval snapshots,
 * all remaining soft references (including native Tasks) and lineage are still
 * required before the staff merge workflow can use it. */
export async function readMergeReferencePage(
  db: D1Database,
  input: {
    organization: string
    survivor: string
    duplicate: string
    kind: MergeReferenceKind
    after?: string
  },
) {
  if (
    !Object.hasOwn(mergeReferenceRules, input.kind) ||
    !input.organization ||
    !input.survivor ||
    !input.duplicate ||
    input.survivor === input.duplicate ||
    (input.after !== undefined && (typeof input.after !== 'string' || input.after.length > 2048))
  )
    throw new Error('Choose a valid merge inventory context.')
  const pair = await db
    .prepare('SELECT count(*) n FROM vc_crm_constituents WHERE organization_id=? AND id IN(?,?)')
    .bind(input.organization, input.survivor, input.duplicate)
    .first<{ n: number }>()
  if (pair?.n !== 2) throw new Error('Choose two constituents from the same organization root.')
  const rule: Rule = mergeReferenceRules[input.kind]
  const key = rule.key || 'r.id'
  const rows = (
    await db
      .prepare(
        `WITH merge_family(id) AS (
      SELECT id FROM vc_crm_constituents WHERE organization_id=?3 AND id IN(?1,?2)
      UNION SELECT identity_id FROM vc_crm_identity_aliases WHERE organization_id=?3 AND canonical_id IN(?1,?2)
    ) SELECT r.*,${key} AS mergeKey,${rule.site} AS mergeSite FROM ${rule.from}
    JOIN vc_sites merge_scope ON merge_scope.id=${rule.site} AND merge_scope.organization_id=?3
    WHERE (${rule.match.replaceAll('IN(?1,?2)', 'IN(SELECT id FROM merge_family)')}) ${input.after === undefined ? '' : `AND ${key}>?4`}
    ORDER BY ${key} LIMIT 26`,
      )
      .bind(
        input.survivor,
        input.duplicate,
        input.organization,
        ...(input.after === undefined ? [] : [input.after]),
      )
      .all<Record<string, unknown> & { mergeKey: string; mergeSite: string }>()
  ).results
  const docs = rows.slice(0, 25)
  return { docs, next: rows.length > 25 ? docs[docs.length - 1].mergeKey : null }
}
