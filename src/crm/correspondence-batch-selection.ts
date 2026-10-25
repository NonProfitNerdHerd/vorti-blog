import { SiteAccessError } from '../organizations/repository'
import { CorrespondenceBatches } from './correspondence-batches'
import type { CorrespondenceBatchConfig } from './correspondence-batch-model'
import { batchText, recipientKey } from './correspondence-batch-model'
import { calendarDate } from './finance'
import { documentAmount } from './correspondence-giving'

/** Select every authorized matching source through keyset pages, with complete matching totals. */
export async function correspondenceCandidates(
  db: D1Database,
  actor: number,
  input: {
    site: string
    batch: string
    after?: string
    search?: string
    from?: string
    through?: string
    givingOnly?: boolean
  },
) {
  const batches = new CorrespondenceBatches(db, actor),
    context = await batches.scope(input.site, input.batch, 'edit')
  if (context.batch.status !== 'draft')
    throw new Error('Reopen the batch before selecting recipients.')
  const config = JSON.parse(context.batch.config) as CorrespondenceBatchConfig,
    search = batchText(input.search || '', 100),
    after = batchText(input.after || '', 128),
    from = input.from ? calendarDate(input.from) : '',
    through = input.through ? calendarDate(input.through) : ''
  if (from && through && through < from) throw new Error('Choose a valid recipient date range.')
  let source: string, params: (string | number)[]
  if (config.source === 'gifts') {
    source = `SELECT g.id,c.id AS contact,c.label,g.id AS gift,NULL AS membership,g.received_on AS date,g.kind,g.net_minor AS minor,g.currency,g.exponent
      FROM vc_crm_gifts g JOIN vc_crm_constituents c ON c.id=g.constituent_id AND c.archived=0
      JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=g.site_id AND a.archived=0
      WHERE g.site_id=? AND instr(lower(c.label),lower(?))>0 AND (?='' OR g.received_on>=?) AND (?='' OR g.received_on<=?)`
    params = [input.site, search, from, from, through, through]
  } else if (config.source === 'memberships') {
    source = `SELECT t.id,c.id AS contact,c.label,NULL AS gift,t.id AS membership,t.ends_on AS date,t.type_name AS kind,NULL AS minor,NULL AS currency,NULL AS exponent
      FROM vc_crm_membership_terms t JOIN vc_crm_constituents c ON c.id=t.billing_contact_id AND c.archived=0
      JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=t.site_id AND a.archived=0
      WHERE t.site_id=? AND instr(lower(c.label),lower(?))>0 AND (?='' OR t.ends_on>=?) AND (?='' OR t.ends_on<=?)`
    params = [input.site, search, from, from, through, through]
  } else {
    const annual = config.kind === 'annual-statement' && input.givingOnly !== false
    source = `SELECT c.id,c.id AS contact,c.label,NULL AS gift,NULL AS membership,NULL AS date,'contact' AS kind,NULL AS minor,NULL AS currency,NULL AS exponent
      FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.archived=0
      WHERE a.site_id=? AND c.archived=0 AND instr(lower(c.label),lower(?))>0
      ${annual ? 'AND EXISTS(SELECT 1 FROM vc_crm_gifts g WHERE g.site_id=a.site_id AND g.constituent_id=c.id AND g.received_on>=? AND g.received_on<?)' : ''}`
    params = [
      input.site,
      search,
      ...(annual ? [`${config.year}-01-01`, `${config.year! + 1}-01-01`] : []),
    ]
  }
  const columns = [
    'id',
    'contact',
    'label',
    'gift',
    'membership',
    'date',
    'kind',
    'minor',
    'currency',
    'exponent',
  ]
  const result = await db
    .prepare(
      `WITH candidates AS (${source}),page AS(SELECT * FROM candidates WHERE id>? ORDER BY id LIMIT 51)
    SELECT (SELECT count(*) FROM candidates) AS total,(SELECT json_group_array(json_object(${columns.map((c) => `'${c}',${c}`).join(',')})) FROM page) AS docs`,
    )
    .bind(...params, after)
    .first<{ total: number; docs: string }>()
  type Row = {
    id: string
    contact: string
    label: string
    gift: string | null
    membership: string | null
    date: string | null
    kind: string
    minor: string | null
    currency: string | null
    exponent: number | null
  }
  const rows = JSON.parse(result!.docs) as Row[]
  const selections = new Map(
    (
      await db
        .prepare(
          `SELECT source_key,document_id FROM vc_crm_correspondence_recipients
    WHERE batch_id=? AND removed=0 AND source_key IN(SELECT value FROM json_each(?))`,
        )
        .bind(
          input.batch,
          JSON.stringify(
            rows.map((row) =>
              recipientKey({
                contact: row.contact,
                ...(row.gift ? { gift: row.gift } : {}),
                ...(row.membership ? { membership: row.membership } : {}),
              }),
            ),
          ),
        )
        .all<{ source_key: string; document_id: string | null }>()
    ).results.map((row) => [row.source_key, row]),
  )
  const current = await batches.scope(input.site, input.batch, 'edit')
  if (
    current.site.authorityRevision !== context.site.authorityRevision ||
    current.batch.revision !== context.batch.revision
  )
    throw new SiteAccessError()
  // Contact affiliation changes have their own revisions and may leave the organization epoch intact.
  if (rows.length) {
    const count = await db
      .prepare(
        `SELECT count(*) AS total FROM json_each(?) x JOIN vc_crm_constituents c
      ON c.id=json_extract(x.value,'$.contact') AND c.archived=0 JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=? AND a.archived=0`,
      )
      .bind(JSON.stringify(rows), input.site)
      .first<number>('total')
    if (count !== rows.length) throw new SiteAccessError()
  }
  return {
    docs: rows.slice(0, 50).map((row) => ({
      id: row.id,
      label: row.label,
      issued: !!selections.get(
        recipientKey({
          contact: row.contact,
          ...(row.gift ? { gift: row.gift } : {}),
          ...(row.membership ? { membership: row.membership } : {}),
        }),
      )?.document_id,
      recipient: {
        contact: row.contact,
        ...(row.gift ? { gift: row.gift } : {}),
        ...(row.membership ? { membership: row.membership } : {}),
      },
      detail: [
        row.date,
        row.kind === 'in-kind' ? 'In-kind gift; no cash valuation' : row.kind,
        row.minor !== null && row.kind !== 'in-kind'
          ? documentAmount(row.minor, row.currency!, row.exponent!)
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    total: result!.total,
    next: rows.length > 50 ? rows[49].id : null,
    revision: context.batch.revision,
    source: config.source,
  }
}
