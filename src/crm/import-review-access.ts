import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { scopeImportRun } from './import-access'
import { importReferenceRules, type ImportReference } from './import-context'
import { importRecordQueriesV1 } from './import-records-v1'
import { importPlanHash, type ImportReview } from './import-domain-plan'
import type { ImportRow } from './import-types'

/** Cached before/after snapshots never substitute for current record access.
 * This read-only check intentionally ignores ordinary revision changes while
 * preserving the original approved snapshot. Deleted/revoked references deny it.
 */
export async function authorizedImportReview(
  db: D1Database,
  actor: number,
  siteID: string,
  runID: string,
  row: ImportRow,
): Promise<ImportReview> {
  const { run, site } = await scopeImportRun(db, actor, siteID, runID)
  if (row.run_id !== run.id || !row.review_json || !row.review_hash) throw new SiteAccessError()
  let review: ImportReview
  try {
    review = JSON.parse(row.review_json)
  } catch {
    throw new SiteAccessError()
  }
  if (
    review.version !== 1 ||
    review.site !== siteID ||
    review.domain !== run.domain ||
    review.actor !== actor ||
    review.sourceSystem !== run.source_system ||
    !review.visibility ||
    !Array.isArray(review.visibility.references) ||
    review.visibility.references.length > 40 ||
    !Array.isArray(review.visibility.contacts) ||
    (await importPlanHash(review)) !== row.review_hash
  )
    throw new SiteAccessError()
  const authority = new OrganizationRepository(db, actor),
    categories = new Set<string>(),
    predicates: string[] = [],
    values: unknown[] = []
  for (const reference of review.visibility.references) {
    if (
      !reference ||
      !Object.hasOwn(importReferenceRules, reference.kind) ||
      typeof reference.id !== 'string' ||
      !reference.id ||
      reference.id.length > 128
    )
      throw new SiteAccessError()
    const rule = importReferenceRules[reference.kind as ImportReference]
    if (!categories.has(rule.category)) {
      if (
        (await authority.require(siteID, rule.category, 'read')).authorityRevision !==
        site.authorityRevision
      )
        throw new SiteAccessError()
      categories.add(rule.category)
    }
    predicates.push(`EXISTS(${rule.sql})`)
    values.push(siteID, reference.id)
  }
  const contacts = [...new Set(review.visibility.contacts)]
  if (contacts.some((id) => typeof id !== 'string' || !id || id.length > 128))
    throw new SiteAccessError()
  const target = row.applied_id || (review.before !== null ? review.targetID : null)
  if (target) {
    predicates.push(`EXISTS(${importRecordQueriesV1[run.domain]})`)
    values.push(siteID, target)
  }
  predicates.push(
    `(SELECT count(DISTINCT c.id) FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.organization_id=c.organization_id WHERE a.site_id=? AND a.archived=0 AND c.archived=0 AND c.id IN(SELECT value FROM json_each(?)))=?`,
  )
  values.push(siteID, JSON.stringify(contacts), contacts.length)
  const current = await db
    .prepare(
      `SELECT authority_revision,CASE WHEN ${predicates.join(' AND ')} THEN 1 ELSE 0 END AS visible FROM vc_organizations WHERE id=?`,
    )
    .bind(...values, site.organization_id)
    .first<{ authority_revision: number; visible: number }>()
  if (current?.authority_revision !== site.authorityRevision || current.visible !== 1)
    throw new SiteAccessError()
  return review
}
