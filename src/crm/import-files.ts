import { SiteConflictError } from '../organizations/atomic'
import { SiteAccessError } from '../organizations/repository'
import { ImportContext } from './import-context'
import { scopeImportRun } from './import-access'
import { importDomain, importSourceSystem } from './import-model'
import { importPlanHash } from './import-domain-plan'
import { commitCRM, replayCRM } from './mutations'
import { putImportUpload, verifyImportObject } from './import-upload'
import { csvImportRows, type ImportTableRow, type CSVResume } from './import-csv'
import {
  readImportWorkbook,
  importWorkbookRows,
  importWorkbookSheets,
  xlsxCompressedLimit,
} from './import-xlsx'
import type { ImportRun } from './import-types'

export const csvImportFileLimit = 50 * 1024 * 1024
export type ImportSourceOptions = { headerRow: number; sheet: string; delimiter: ',' | ';' | '\t' }
export type ImportSourceCursor =
  { kind: 'csv'; resume: CSVResume } | { kind: 'xlsx'; after: number }
export type ImportInspection = {
  sheets: Array<{ name: string; hidden: boolean }>
  options: ImportSourceOptions
  headers: string[]
  rows: ImportTableRow[]
  cursor: ImportSourceCursor
  signature: string
}
type Mutation = { site: string; id: string; expectedRevision: number; operationKey: string }
const text = (raw: unknown, max: number, label: string) => {
  if (
    typeof raw !== 'string' ||
    !raw.trim() ||
    raw.trim().length > max ||
    /[\u0000-\u001f\u007f]/.test(raw)
  )
    throw new Error(`Enter a valid ${label}.`)
  return raw.trim()
}
export class ImportFiles {
  constructor(
    private db: D1Database,
    private storage: R2Bucket,
    private actor: number,
  ) {}
  async create(input: {
    site: string
    name: string
    domain: unknown
    sourceSystem: unknown
    filename: unknown
    size: unknown
    sha256: unknown
    operationKey: string
  }) {
    const domain = importDomain(input.domain),
      sourceSystem = importSourceSystem(input.sourceSystem),
      name = text(input.name, 180, 'import name')
    const filename = text(input.filename, 180, 'CSV or XLSX filename')
        .normalize('NFC')
        .replace(/[\\/]/g, '_'),
      extension = filename.split('.').at(-1)?.toLowerCase()
    if (extension !== 'csv' && extension !== 'xlsx')
      throw new Error('Choose a CSV or XLSX source file.')
    const size = Number(input.size),
      sha256 = String(input.sha256)
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > (extension === 'csv' ? csvImportFileLimit : xlsxCompressedLimit)
    )
      throw new Error('Choose a CSV file up to 50 MiB or an XLSX file up to 8 MiB.')
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Choose a valid SHA-256 source checksum.')
    const context = await ImportContext.open(this.db, this.actor, input.site, domain, sourceSystem)
    if (domain === 'volunteer-hours') await context.require('restricted-activity', 'read')
    const intent = { name, domain, sourceSystem, filename, size, sha256 },
      action = 'import.created'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'crm-import',
      intent,
    })
    if (replay) return replay
    const id = crypto.randomUUID(),
      now = new Date().toISOString(),
      fileKey = `crm-imports/${context.site.organization_id}/${input.site}/${id}/source-${sha256}.${extension}`
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: context.site.organization_id,
      authorityRevision: context.site.authorityRevision,
      action,
      type: 'crm-import',
      id,
      intent,
      after: intent,
      write: this.db
        .prepare(
          'INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,financial,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          input.site,
          this.actor,
          name,
          domain,
          sourceSystem,
          filename,
          extension,
          size,
          sha256,
          fileKey,
          domain === 'gifts' ? 1 : 0,
          now,
          now,
        ),
      result: { id, revision: 1 },
    })
  }
  async upload(input: Mutation & { body: ReadableStream<Uint8Array> }) {
    const { run, site } = await scopeImportRun(this.db, this.actor, input.site, input.id, 'edit')
    const intent = { id: run.id, revision: input.expectedRevision, sha256: run.file_sha256 },
      action = 'import.uploaded'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'crm-import',
      intent,
    })
    if (replay) {
      await input.body.cancel().catch(() => {})
      return replay
    }
    if (
      run.status !== 'draft' ||
      run.stage_state !== 'uploading' ||
      run.revision !== input.expectedRevision
    )
      throw new SiteConflictError()
    await putImportUpload(this.storage, run.file_key, input.body, run)
    const current = await scopeImportRun(this.db, this.actor, input.site, input.id, 'edit')
    if (current.site.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    const now = new Date().toISOString()
    // Never delete a verified object on an uncertain D1 outcome; retries may have published it.
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'crm-import',
      id: run.id,
      intent,
      after: { uploaded: true },
      write: this.db
        .prepare(
          "UPDATE vc_crm_import_runs SET file_uploaded_at=?,stage_state='ready',revision=revision+1,updated_at=? WHERE id=? AND actor_id=? AND revision=? AND stage_state='uploading' AND status='draft'",
        )
        .bind(now, now, run.id, this.actor, input.expectedRevision),
      result: { id: run.id, revision: input.expectedRevision + 1 },
    })
  }
  private async object(run: ImportRun) {
    if (!run.file_uploaded_at) throw new Error('Choose and upload the source file first.')
    const object = await this.storage.get(run.file_key)
    try {
      verifyImportObject(object, run)
    } catch (error) {
      await object?.body.cancel().catch(() => {})
      throw error
    }
    return object!
  }
  async inspect(
    siteID: string,
    id: string,
    raw: Partial<ImportSourceOptions> = {},
  ): Promise<ImportInspection> {
    const { run, site } = await scopeImportRun(this.db, this.actor, siteID, id)
    if (run.stage_state !== 'ready' || run.status !== 'draft')
      throw new Error('Choose source options before staging the import.')
    const headerRow = raw.headerRow ?? 1,
      delimiter = raw.delimiter ?? ',',
      sheet = raw.sheet ?? ''
    if (
      !Number.isSafeInteger(headerRow) ||
      headerRow < 1 ||
      ![',', ';', '\t'].includes(delimiter) ||
      typeof sheet !== 'string' ||
      sheet.length > 240
    )
      throw new Error('Choose a valid header row, worksheet and delimiter.')
    const object = await this.object(run),
      rows: ImportTableRow[] = []
    let sheets: Array<{ name: string; hidden: boolean }> = [],
      selected = sheet,
      headers: string[] | null = null,
      cursor: ImportSourceCursor | null = null,
      total = 0
    const consume = (row: ImportTableRow) => {
      if (row.number === headerRow) {
        if (
          row.issues.length ||
          !row.values.some((value) => value.trim()) ||
          row.values.some((value) => value.length > 500)
        )
          throw new Error(
            'Choose a nonempty header row without formulas or errors and labels up to 500 characters.',
          )
        headers = row.values
      } else if (row.number > headerRow) {
        const bytes = new TextEncoder().encode(JSON.stringify(row)).length
        if (bytes > 1048576) throw new Error('Choose source records smaller than 1 MiB for review.')
        if (rows.length && total + bytes > 262144) return false
        rows.push(row)
        total += bytes
        if (rows.length >= 20) return false
      }
      return true
    }
    if (run.file_kind === 'csv') {
      if (sheet) {
        await object.body.cancel().catch(() => {})
        throw new Error('Choose a worksheet only for XLSX imports.')
      }
      for await (const row of csvImportRows(object.body, { delimiter })) {
        if (row.number === headerRow) cursor = { kind: 'csv', resume: row.next }
        if (!consume(row)) break
      }
    } else {
      const book = await readImportWorkbook(new Uint8Array(await object.arrayBuffer()))
      sheets = importWorkbookSheets(book)
      selected = sheet || sheets[0]?.name || ''
      for (const row of importWorkbookRows(book, selected)) {
        if (row.number === headerRow) cursor = { kind: 'xlsx', after: row.number }
        if (!consume(row)) break
      }
    }
    if (!headers || !cursor) throw new Error('Choose an existing nonempty header row.')
    const options: ImportSourceOptions = { headerRow, delimiter, sheet: selected }
    const signature = await importPlanHash({
      id: run.id,
      sha256: run.file_sha256,
      options,
      headers,
      cursor,
    })
    const current = await scopeImportRun(this.db, this.actor, siteID, id)
    if (
      current.site.authorityRevision !== site.authorityRevision ||
      current.run.revision !== run.revision
    )
      throw new SiteConflictError()
    return { sheets, options, headers, rows, cursor, signature }
  }
  async configure(input: Mutation & { options: Partial<ImportSourceOptions>; signature: string }) {
    const { run, site } = await scopeImportRun(this.db, this.actor, input.site, input.id, 'edit')
    const action = 'import.source.configured',
      intent = {
        id: run.id,
        expectedRevision: input.expectedRevision,
        options: input.options,
        signature: input.signature,
      }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'crm-import',
      intent,
    })
    if (replay) return replay
    if (
      run.revision !== input.expectedRevision ||
      run.status !== 'draft' ||
      run.stage_state !== 'ready' ||
      run.job_id
    )
      throw new SiteConflictError()
    const inspected = await this.inspect(input.site, run.id, input.options)
    if (inspected.signature !== input.signature) throw new SiteConflictError()
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'crm-import',
      id: run.id,
      intent,
      after: { options: inspected.options, headers: inspected.headers },
      write: this.db
        .prepare(
          "UPDATE vc_crm_import_runs SET header_row=?,sheet_name=?,delimiter=?,headers_json=?,stage_cursor=?,config_revision=config_revision+1,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='draft' AND stage_state='ready' AND job_id IS NULL",
        )
        .bind(
          inspected.options.headerRow,
          inspected.options.sheet,
          inspected.options.delimiter,
          JSON.stringify(inspected.headers),
          JSON.stringify(inspected.cursor),
          new Date().toISOString(),
          run.id,
          run.revision,
        ),
      result: { id: run.id, revision: run.revision + 1 },
    })
  }
  async download(siteID: string, id: string) {
    const { run, site } = await scopeImportRun(this.db, this.actor, siteID, id),
      object = await this.object(run)
    try {
      if (
        (await scopeImportRun(this.db, this.actor, siteID, id)).site.authorityRevision !==
        site.authorityRevision
      )
        throw new SiteAccessError()
    } catch (error) {
      await object.body.cancel().catch(() => {})
      throw error
    }
    return new Response(object.body, {
      headers: {
        'Content-Type':
          run.file_kind === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Length': String(run.file_size),
        'Content-Disposition': `attachment; filename="source-${run.id.replace(/[^a-zA-Z0-9_-]/g, '')}.${run.file_kind}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
}
