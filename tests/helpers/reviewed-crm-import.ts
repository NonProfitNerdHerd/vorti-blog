import { prepareImportDomain, type ImportPlanInput } from '../../src/crm/import-domain-plan'
import { CRMJobs } from '../../src/crm/jobs'
import { importApplyJob } from '../../src/crm/import-apply-job'
import type { ImportRow } from '../../src/crm/import-types'
import type { crmImportFixture } from './crm-import-fixture'
export type ImportFixture = Awaited<ReturnType<typeof crmImportFixture>>
export async function reviewedCRMImport(
  fixture: ImportFixture,
  inputs: Array<Omit<ImportPlanInput, 'operationKey'>>,
  options: { actor?: number; allowUnidentified?: boolean } = {},
) {
  const actor = options.actor ?? 1,
    first = inputs[0],
    id = crypto.randomUUID(),
    now = new Date().toISOString()
  if (
    !first ||
    inputs.some(
      (input) =>
        input.site !== first.site ||
        input.domain !== first.domain ||
        input.sourceSystem !== first.sourceSystem,
    )
  )
    throw new Error('One section per fixture import')
  const plans = []
  for (const input of inputs)
    plans.push(
      await prepareImportDomain(fixture.db, actor, { ...input, operationKey: crypto.randomUUID() }),
    )
  const headers = Object.keys(first.values),
    mapping = {
      version: 1,
      domain: first.domain,
      headers,
      columns: headers.map((field, column) => ({
        field,
        column,
        clearBlank: false,
        referenceMode: 'record',
      })),
    }
  fixture.sqlite
    .prepare(
      `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,file_uploaded_at,headers_json,mapping_json,stage_state,financial,allow_new_unidentified,created_at,updated_at) VALUES(?,?,?,'Fictional reviewed import',?,?,'fictional.csv','csv',1,?,?,?, ?,?,'staging',?,?,?,?)`,
    )
    .run(
      id,
      first.site,
      actor,
      first.domain,
      first.sourceSystem,
      'a'.repeat(64),
      crypto.randomUUID(),
      now,
      JSON.stringify(headers),
      JSON.stringify(mapping),
      plans.some((plan) => plan.financial) ? 1 : 0,
      options.allowUnidentified ? 1 : 0,
      now,
      now,
    )
  for (const [index, input] of inputs.entries())
    fixture.sqlite
      .prepare('INSERT INTO vc_crm_import_rows(run_id,number,data_json) VALUES(?,?,?)')
      .run(id, index + 2, JSON.stringify(Object.values(input.values).map((cell) => cell.value)))
  fixture.sqlite.prepare("UPDATE vc_crm_import_runs SET stage_state='review' WHERE id=?").run(id)
  for (const [index, plan] of plans.entries())
    fixture.sqlite
      .prepare(
        'UPDATE vc_crm_import_rows SET decision=?,target_id=?,source_id=?,review_json=?,review_hash=?,review_config_revision=1,review_authority_revision=? WHERE run_id=? AND number=?',
      )
      .run(
        plan.review.selection.decision,
        plan.review.targetID,
        plan.review.sourceID,
        JSON.stringify(plan.review),
        plan.hash,
        plan.review.authorityRevision,
        id,
        index + 2,
      )
  const jobs = new CRMJobs(fixture.db),
    job = await jobs.enqueue({
      site: first.site,
      actor,
      kind: 'import-apply',
      payload: { v: 1, phase: 'apply', run: id, revision: 2 },
      operationKey: crypto.randomUUID(),
    })
  fixture.sqlite
    .prepare(
      "UPDATE vc_crm_import_runs SET status='approved',revision=2,job_id=?,approved_authority_revision=? WHERE id=?",
    )
    .run(String(job.id), plans[0].review.authorityRevision, id)
  return { id, job: String(job.id), plans, jobs }
}
export async function finishReviewedImport(
  fixture: ImportFixture,
  queued: Awaited<ReturnType<typeof reviewedCRMImport>>,
) {
  const handler = importApplyJob(fixture.db)
  for (let index = 0; index < 1000; index++)
    if (!(await queued.jobs.tick({ 'import-apply': handler }, queued.job))) break
  const job = fixture.sqlite
    .prepare('SELECT status,error,cursor FROM vc_crm_jobs WHERE id=?')
    .get(queued.job)!
  if (job.status !== 'completed')
    throw new Error(`Fictional import did not complete: ${JSON.stringify(job)}`)
  return fixture.sqlite
    .prepare('SELECT * FROM vc_crm_import_rows WHERE run_id=? ORDER BY number')
    .all(queued.id) as unknown as ImportRow[]
}
