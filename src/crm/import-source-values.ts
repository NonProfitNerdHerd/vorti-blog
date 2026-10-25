import { SiteAccessError } from '../organizations/repository'
import { scopeImportRun } from './import-access'
/** Original uploaded values only; no resolved CRM snapshots or source claims. */
export async function importSourceValues(
  db: D1Database,
  actor: number,
  site: string,
  id: string,
  column: number,
  after = 0,
) {
  const initial = await scopeImportRun(db, actor, site, id),
    headers = JSON.parse(initial.run.headers_json) as string[]
  if (
    initial.run.stage_state !== 'review' ||
    !Number.isSafeInteger(column) ||
    column < 0 ||
    column >= headers.length ||
    !Number.isSafeInteger(after) ||
    after < 0
  )
    throw Error('Choose a staged source column and valid value page.')
  const path = `$[${column}]`,
    snapshot = await db
      .prepare(
        `WITH values_in_source AS(SELECT json_extract(data_json,?) AS value FROM vc_crm_import_rows WHERE run_id=? AND json_type(data_json,?)='text'),
    grouped AS(SELECT value,count(*) AS occurrences FROM values_in_source GROUP BY value COLLATE BINARY),
    numbered AS(SELECT value,occurrences,row_number() OVER(ORDER BY value COLLATE BINARY) AS position FROM grouped),
    candidates AS(SELECT *,sum(length(CAST(json_quote(value) AS BLOB))+128) OVER(ORDER BY position) AS bytes FROM numbered WHERE position>? ORDER BY position LIMIT 50),
    page AS(SELECT * FROM candidates WHERE bytes<=262144 OR position=(SELECT min(position) FROM candidates))
    SELECT(SELECT count(*) FROM numbered) AS total,(SELECT json_group_array(json_object('value',value,'occurrences',occurrences,'position',position)) FROM page) AS docs`,
      )
      .bind(path, id, path, after)
      .first<{ total: number; docs: string }>()
  if (!snapshot) throw Error('Unable to read distinct source values.')
  const current = await scopeImportRun(db, actor, site, id)
  if (current.site.authorityRevision !== initial.site.authorityRevision) throw new SiteAccessError()
  const rows = JSON.parse(snapshot.docs) as Array<{
    value: string
    occurrences: number
    position: number
  }>
  return {
    docs: rows,
    total: snapshot.total,
    next: rows.length && rows.at(-1)!.position < snapshot.total ? rows.at(-1)!.position : null,
  }
}
