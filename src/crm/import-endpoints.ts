import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { ImportFiles, type ImportSourceOptions } from './import-files'
import { ImportRuns } from './import-runs'
import { ImportReviewRepository } from './import-review'
import { startImportStaging } from './import-staging'
import { approveImport, reopenImport } from './import-approval'
import { scopeImportRun } from './import-access'
import { CRMJobs } from './jobs'
import type { ImportDecision } from './import-domain-plan'
import type { MappedImportCell } from './import-model'
import { SiteConflictError } from '../organizations/atomic'
import { startImportBulkReview } from './import-bulk-review'
import { importResultsCSV } from './import-results'
import { ImportReferenceOptions } from './import-reference-options'
import { importSourceValues } from './import-source-values'
import { listImportExports, controlImportExport } from './import-export-controls'
import { startImportExport } from './import-exports'
import { importExportDownload } from './import-export-download'

/** Register with the connected workflow, migration and durable dispatch. The
 * transport carries job IDs only; handlers reauthorize their recorded actor. */
export function importEndpoints(
  platform: { db: D1Database; storage: R2Bucket; wake: (job: string) => Promise<void> },
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  const { db, storage } = platform,
    headers = { 'Cache-Control': 'private, no-store' }
  return [
    {
      path: '/crm/imports',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401, headers })
        try {
          const params = new URL(req.url!).searchParams,
            actor = Number(req.user.id),
            site = params.get('site') || '',
            id = params.get('id') || '',
            view = params.get('view') || (id ? 'run' : 'list')
          const runs = new ImportRuns(db, actor),
            files = new ImportFiles(db, storage, actor)
          if (view === 'source') return await files.download(site, id)
          if (view === 'result-file')
            return await importExportDownload(
              db,
              storage,
              actor,
              site,
              id,
              params.get('export') || '',
            )
          if (view === 'results' || view === 'errors')
            return await importResultsCSV(db, actor, site, id, view === 'errors')
          let result: unknown
          if (view === 'result-files')
            result = await listImportExports(db, actor, site, id, params.get('after') || '')
          else if (view === 'values')
            result = await importSourceValues(
              db,
              actor,
              site,
              id,
              params.has('column') ? Number(params.get('column')) : NaN,
              Number(params.get('after') || 0),
            )
          else if (view === 'references')
            result = await new ImportReferenceOptions(db, actor).list({
              site,
              id,
              field: params.get('field') || '',
              search: params.get('search') || '',
              after: params.get('after') || '',
            })
          else if (view === 'context') result = await runs.context(site)
          else if (view === 'list')
            result = await runs.list({
              site,
              domain: params.get('domain'),
              after: params.get('after') || '',
            })
          else if (view === 'run') result = await runs.get(site, id)
          else if (view === 'rows')
            result = await runs.rows({
              site,
              id,
              after: Number(params.get('after') || 0),
              filter: params.get('filter') || 'all',
            })
          else if (view === 'row')
            result = { doc: await runs.row(site, id, Number(params.get('number'))) }
          else if (view === 'review')
            result = {
              doc: await new ImportReviewRepository(db, actor).snapshot(
                site,
                id,
                Number(params.get('number')),
              ),
            }
          else if (view === 'inspect')
            result = await files.inspect(site, id, {
              headerRow: Number(params.get('headerRow') || 1),
              sheet: params.get('sheet') || '',
              delimiter: (params.get('delimiter') || ',') as ImportSourceOptions['delimiter'],
            })
          else throw new Error('Choose a supported import view.')
          return Response.json(result, { headers })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/imports',
      method: 'post',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401, headers })
        if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url!).origin)
          return Response.json(
            { message: 'Use the signed-in site to save changes.' },
            { status: 403, headers },
          )
        try {
          const body = await readBoundedJSON(req, 1048576),
            actor = Number(req.user.id),
            files = new ImportFiles(db, storage, actor),
            reviews = new ImportReviewRepository(db, actor)
          const input = {
            site: String(body.site || ''),
            id: String(body.id || ''),
            expectedRevision: Number(body.expectedRevision),
            operationKey: String(body.operationKey || ''),
          }
          let doc: Record<string, unknown>,
            wakeJob: string | null = null
          if (body.action === 'prepare-results') {
            doc = await startImportExport(db, actor, {
              ...input,
              errorsOnly: body.errorsOnly as boolean,
            })
            wakeJob = String(doc.job)
          } else if (
            ['cancel-results', 'retry-results', 'wake-results'].includes(String(body.action))
          ) {
            doc = await controlImportExport(db, actor, {
              ...input,
              export: String(body.export || ''),
              expectedFence: Number(body.expectedFence),
              action: body.action as 'cancel-results' | 'retry-results' | 'wake-results',
            })
            if (body.action !== 'cancel-results') wakeJob = String(doc.job)
          } else if (body.action === 'create')
            doc = await files.create({
              site: input.site,
              name: body.name as string,
              domain: body.domain,
              sourceSystem: body.sourceSystem,
              filename: body.filename,
              size: body.size,
              sha256: body.sha256,
              operationKey: input.operationKey,
            })
          else if (body.action === 'configure')
            doc = await files.configure({
              ...input,
              options: body.options as Partial<ImportSourceOptions>,
              signature: String(body.signature || ''),
            })
          else if (body.action === 'stage') {
            doc = await startImportStaging(db, actor, input)
            wakeJob = String(doc.job)
          } else if (body.action === 'bulk-review') {
            doc = await startImportBulkReview(db, actor, { ...input, policy: body.policy })
            wakeJob = String(doc.job)
          } else if (body.action === 'mapping')
            doc = await reviews.mapping({ ...input, mapping: body.mapping })
          else if (body.action === 'review')
            doc = await reviews.review({
              ...input,
              number: Number(body.number),
              rowRevision: Number(body.rowRevision),
              decision: body.decision as ImportDecision,
              target: body.target as string | null | undefined,
              overrides: body.overrides as Record<string, MappedImportCell> | undefined,
            })
          else if (body.action === 'approve') {
            doc = await approveImport(db, actor, {
              ...input,
              allowNewUnidentified: body.allowNewUnidentified as boolean,
            })
            wakeJob = String(doc.job)
          } else if (body.action === 'reopen') doc = await reopenImport(db, actor, input)
          else if (['cancel', 'retry', 'wake'].includes(String(body.action))) {
            const { run } = await scopeImportRun(db, actor, input.site, input.id, 'edit')
            if (run.revision !== input.expectedRevision) throw new SiteConflictError()
            if (!run.job_id) throw new Error('Choose an import with a processing job.')
            const runner = new CRMJobs(db)
            if (body.action === 'cancel')
              doc = await runner.cancel(
                actor,
                input.site,
                run.job_id,
                input.operationKey,
                Number(body.expectedFence),
              )
            else if (body.action === 'retry') {
              doc = await runner.retry(
                actor,
                input.site,
                run.job_id,
                Number(body.expectedFence),
                input.operationKey,
              )
              wakeJob = run.job_id
            } else {
              doc = { id: run.id, job: run.job_id }
              wakeJob = run.job_id
            }
            doc = { ...doc, id: run.id, revision: run.revision, job: run.job_id }
          } else throw new Error('Choose a supported import action.')
          let wakePending = false
          if (wakeJob)
            try {
              await platform.wake(wakeJob)
            } catch {
              wakePending = true
            }
          return Response.json({ doc, backgroundWakePending: wakePending }, { headers })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/imports/source',
      method: 'put',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401, headers })
        if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url!).origin)
          return Response.json(
            { message: 'Use the signed-in site to save changes.' },
            { status: 403, headers },
          )
        try {
          if (!req.body) throw new Error('Choose source file data to upload.')
          const params = new URL(req.url!).searchParams
          const doc = await new ImportFiles(db, storage, Number(req.user.id)).upload({
            site: params.get('site') || '',
            id: params.get('id') || '',
            expectedRevision: Number(params.get('expectedRevision')),
            operationKey: params.get('operationKey') || '',
            body: req.body,
          })
          return Response.json({ doc }, { headers })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
