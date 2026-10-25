import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { CRMRecordAccess } from './record-access'
import { crmRecordLink, type CRMRecordLink } from './record-model'
import {
  attachmentMetadata,
  attachmentDisposition,
  crmAttachmentCategories,
  validateAttachmentBytes,
  type CRMAttachmentCategory,
} from './attachment-model'
import { commitCRM, replayCRM } from './mutations'

type Attachment = {
  id: string
  site_id: string
  record_type: CRMRecordLink['type']
  record_id: string
  category: CRMAttachmentCategory
  filename: string
  mime: string
  bytes: number
  sha256: string
  object_key: string
  created_by: number
  state: 'staged' | 'ready' | 'archived' | 'cancelled' | 'expired'
  revision: number
  ready_at: string | null
  created_at: string
  updated_at: string
}
type Request = { site: string; link: CRMRecordLink }
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('')
const publicFile = ({ object_key: _key, ...file }: Attachment) => file

/** Immutable bytes live exclusively in WORKSPACE_FILES. No public object URLs are returned. */
export class CRMAttachments {
  private authority: OrganizationRepository
  private records: CRMRecordAccess
  constructor(
    private db: D1Database,
    private storage: R2Bucket,
    private actor: number,
    private now: () => number = Date.now,
  ) {
    this.authority = new OrganizationRepository(db, actor)
    this.records = new CRMRecordAccess(db, actor)
  }
  private async scope(input: Request, category: CRMAttachmentCategory, operation: 'read' | 'edit') {
    const context = await this.records.resolve(input.site, input.link, operation)
    const read = await this.authority.require(input.site, category, 'read')
    const grant =
      operation === 'edit' ? await this.authority.require(input.site, category, 'edit') : read
    if (
      grant.authorityRevision !== context.site.authorityRevision ||
      read.authorityRevision !== context.site.authorityRevision
    )
      throw new SiteAccessError()
    return context.site
  }
  private async row(input: Request & { id: string }, operation: 'read' | 'edit' = 'read') {
    const context = await this.records.resolve(input.site, input.link, operation)
    const file = await this.db
      .prepare(
        'SELECT * FROM vc_crm_attachments WHERE id=? AND site_id=? AND record_type=? AND record_id=?',
      )
      .bind(input.id, input.site, input.link.type, input.link.id)
      .first<Attachment>()
    if (!file) throw new SiteAccessError()
    const site = await this.scope(input, file.category, operation)
    if (site.authorityRevision !== context.site.authorityRevision) throw new SiteAccessError()
    return { file, site }
  }
  async list(input: Request & { archived?: boolean; beforeDate?: string; beforeID?: string }) {
    const context = await this.records.resolve(input.site, input.link)
    if (
      !!input.beforeDate !== !!input.beforeID ||
      (input.beforeDate && new Date(input.beforeDate).toISOString() !== input.beforeDate)
    )
      throw new Error('Invalid page cursor.')
    const readable: CRMAttachmentCategory[] = [],
      editable: CRMAttachmentCategory[] = []
    const parentEdit = (await this.authority.authority(input.site, context.category, 'edit'))
      .allowed
    for (const category of crmAttachmentCategories) {
      if (!(await this.authority.authority(input.site, category, 'read')).allowed) continue
      readable.push(category)
      if (parentEdit && (await this.authority.authority(input.site, category, 'edit')).allowed)
        editable.push(category)
    }
    const rows = readable.length
      ? (
          await this.db
            .prepare(
              `SELECT * FROM vc_crm_attachments WHERE site_id=? AND record_type=? AND record_id=?
      AND category IN(${readable.map(() => '?').join(',')}) AND ${input.archived ? "state='archived'" : "(state='ready' OR (ready_at IS NULL AND created_by=?))"}
      ${input.beforeDate ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''} ORDER BY created_at DESC,id DESC LIMIT 51`,
            )
            .bind(
              input.site,
              input.link.type,
              input.link.id,
              ...readable,
              ...(input.archived ? [] : [this.actor]),
              ...(input.beforeDate ? [input.beforeDate, input.beforeDate, input.beforeID!] : []),
            )
            .all<Attachment>()
        ).results
      : []
    const current = await this.records.resolve(input.site, input.link)
    if (current.site.authorityRevision !== context.site.authorityRevision)
      throw new SiteAccessError()
    return {
      record: { type: input.link.type, id: current.record.id, label: current.record.label },
      docs: rows
        .slice(0, 50)
        .map((file) => ({ ...publicFile(file), canEdit: editable.includes(file.category) })),
      next: rows.length > 50 ? { date: rows[49].created_at, id: rows[49].id } : null,
      categories: editable,
    }
  }
  async stage(input: Request & { operationKey: string; values: Record<string, unknown> }) {
    const values = attachmentMetadata(input.values),
      link = crmRecordLink(input.link.type, input.link.id)
    const site = await this.scope(input, values.category, 'edit'),
      intent = { link, ...values }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'attachment.staged',
      type: 'crm-attachment',
      intent,
    })
    if (replay) {
      await this.row({ ...input, id: String(replay.id) })
      return replay
    }
    const id = crypto.randomUUID(),
      now = new Date(this.now()).toISOString()
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'attachment.staged',
      type: 'crm-attachment',
      id,
      after: intent,
      intent,
      write: this.db
        .prepare(
          'INSERT INTO vc_crm_attachments(id,site_id,record_type,record_id,category,filename,mime,bytes,sha256,object_key,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          input.site,
          link.type,
          link.id,
          values.category,
          values.filename,
          values.mime,
          values.size,
          values.sha256,
          `crm/attachments/${encodeURIComponent(input.site)}/${id}/${crypto.randomUUID()}`,
          this.actor,
          now,
          now,
        ),
      dependent: [
        ...this.records.guard(input.site, link, input.operationKey + ':record'),
        this.event(id, 'staged', input.operationKey, now),
      ],
      result: { id, revision: 1 },
    })
  }
  private event(id: string, action: string, key: string, now: string) {
    return this.db
      .prepare(
        'INSERT INTO vc_crm_attachment_events(id,attachment_id,action,actor_id,operation_key,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(crypto.randomUUID(), id, action, this.actor, key, now)
  }
  async upload(
    input: Request & {
      id: string
      expectedRevision: number
      operationKey: string
      body: ReadableStream<Uint8Array>
    },
  ) {
    const { file, site } = await this.row(input, 'edit')
    if (file.created_by !== this.actor) throw new SiteAccessError()
    if (!Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    const reader = input.body.getReader(),
      chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > file.bytes)
          throw Object.assign(new Error('Enter file data matching the staged attachment size.'), {
            status: 413,
          })
        chunks.push(value)
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    validateAttachmentBytes({ mime: file.mime, size: file.bytes }, bytes)
    if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== file.sha256)
      throw new Error('Enter file data matching the staged attachment checksum.')
    const intent = { id: input.id, revision: input.expectedRevision, sha256: file.sha256 }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'attachment.uploaded',
      type: 'crm-attachment',
      intent,
    })
    if (replay) return replay
    if (
      file.state !== 'staged' ||
      file.revision !== input.expectedRevision ||
      Date.parse(file.created_at) <= this.now() - 86400000
    )
      throw new SiteConflictError()
    const stored = await this.storage.put(file.object_key, bytes, {
      onlyIf: { etagDoesNotMatch: '*' },
      sha256: file.sha256,
      httpMetadata: { contentType: file.mime, cacheControl: 'private, no-store' },
    })
    const object = stored || (await this.storage.head(file.object_key))
    if (
      !object ||
      object.size !== file.bytes ||
      !object.checksums.sha256 ||
      hex(object.checksums.sha256) !== file.sha256
    )
      throw new Error('The private upload could not be verified.')
    const current = await this.row(input, 'edit')
    if (current.site.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    const now = new Date(this.now()).toISOString()
    // Never delete on an uncertain commit: a concurrent retry may already have published the same immutable object.
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'attachment.uploaded',
      type: 'crm-attachment',
      id: input.id,
      before: { state: 'staged' },
      after: { state: 'ready' },
      intent,
      write: this.db
        .prepare(
          "UPDATE vc_crm_attachments SET state='ready',ready_at=?,revision=revision+1,updated_at=? WHERE id=? AND state='staged' AND revision=? AND created_by=?",
        )
        .bind(now, now, input.id, input.expectedRevision, this.actor),
      dependent: [
        ...this.records.guard(input.site, input.link, input.operationKey + ':record'),
        this.event(input.id, 'uploaded', input.operationKey, now),
      ],
      result: { id: input.id, revision: input.expectedRevision + 1, state: 'ready' },
    })
  }
  async control(
    input: Request & {
      id: string
      expectedRevision: number
      operationKey: string
      action: 'archive' | 'restore' | 'cancel'
    },
  ) {
    const { file, site } = await this.row(input, 'edit'),
      intent = { id: input.id, revision: input.expectedRevision, action: input.action }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'attachment.' + input.action,
      type: 'crm-attachment',
      intent,
    })
    if (replay) return replay
    const from =
      input.action === 'archive' ? 'ready' : input.action === 'restore' ? 'archived' : 'staged'
    const to =
      input.action === 'archive' ? 'archived' : input.action === 'restore' ? 'ready' : 'cancelled'
    if (
      file.state !== from ||
      !Number.isSafeInteger(input.expectedRevision) ||
      file.revision !== input.expectedRevision
    )
      throw new SiteConflictError()
    if (input.action === 'cancel' && file.created_by !== this.actor) throw new SiteAccessError()
    const now = new Date(this.now()).toISOString()
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'attachment.' + input.action,
      type: 'crm-attachment',
      id: input.id,
      before: { state: from },
      after: { state: to },
      intent,
      write: this.db
        .prepare(
          'UPDATE vc_crm_attachments SET state=?,revision=revision+1,updated_at=? WHERE id=? AND state=? AND revision=?',
        )
        .bind(to, now, input.id, from, input.expectedRevision),
      dependent: [
        ...this.records.guard(input.site, input.link, input.operationKey + ':record'),
        this.event(input.id, input.action, input.operationKey, now),
      ],
      result: { id: input.id, revision: input.expectedRevision + 1, state: to },
    })
  }
  async download(input: Request & { id: string }) {
    const { file } = await this.row(input)
    if (!['ready', 'archived'].includes(file.state)) throw new SiteAccessError()
    const object = await this.storage.get(file.object_key)
    if (!object)
      throw Object.assign(new Error('Choose an available private attachment.'), { status: 404 })
    try {
      if (
        object.size !== file.bytes ||
        !object.checksums.sha256 ||
        hex(object.checksums.sha256) !== file.sha256
      )
        throw new Error('The private attachment could not be verified.')
      const current = await this.row(input)
      if (!['ready', 'archived'].includes(current.file.state)) throw new SiteAccessError()
    } catch (error) {
      await object.body.cancel()
      throw error
    }
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(file.bytes),
        'Content-Disposition': attachmentDisposition(file.filename),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    })
  }
}
