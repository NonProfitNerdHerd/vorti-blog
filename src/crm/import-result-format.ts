import { importCSVLine } from './import-result-csv'
import { authorizedImportReview } from './import-review-access'
import type { ImportRow, ImportRun } from './import-types'
export const importResultCondition = (errorsOnly: boolean) =>
  errorsOnly
    ? " AND (json_array_length(parse_issues)>0 OR coalesce(json_array_length(review_json,'$.issues'),0)>0)"
    : ''
export function importResultHeader(headers: string[], width: number) {
  return (
    '\ufeff' +
    importCSVLine([
      'Source row',
      'Saved decision',
      'Review state',
      'Applied result',
      'Applied at',
      'Issues',
      ...Array.from(
        { length: width },
        (_, index) => `${index + 1}. ${headers[index] || '(no header)'}`,
      ),
    ])
  )
}
export async function importResultLine(
  db: D1Database,
  actor: number,
  run: ImportRun,
  epoch: number,
  row: ImportRow,
  width: number,
) {
  const issues = (JSON.parse(row.parse_issues) as Array<{ column: number; message: string }>).map(
    (issue) => `Column ${issue.column + 1}: ${issue.message}`,
  )
  let state = 'Not reviewed'
  if (row.review_hash) {
    const review = await authorizedImportReview(db, actor, run.site_id, run.id, row)
    state =
      row.review_config_revision === run.config_revision && row.review_authority_revision === epoch
        ? 'Current'
        : 'Needs review'
    issues.push(
      ...review.issues.map((issue) => `${issue.field ? issue.field + ': ' : ''}${issue.message}`),
    )
  }
  const values = JSON.parse(row.data_json) as string[]
  return importCSVLine([
    row.number,
    row.decision,
    state,
    row.applied_action,
    row.applied_at,
    issues.join('\n'),
    ...Array.from({ length: width }, (_, index) => values[index] ?? ''),
  ])
}
