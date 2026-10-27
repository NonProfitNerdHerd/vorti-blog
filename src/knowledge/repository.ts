import { TenantRepository } from '../organizations/tenant-repository'
import { effectiveFeature, evaluateTenantPermission } from '../organizations/tenant-policy'
import { tenantAuthorityActive, featureAvailableAt } from '../organizations/tenant-runtime'
import { publicWebsite } from '../organizations/public-website'
import { atomicSiteMutation, SiteConflictError } from '../organizations/atomic'
import { validateKnowledgeBody, type KnowledgeKind } from './content'
import type { Permission } from '../organizations/permission-catalog'
import { fileSignature, safeFilename } from '../forms/security'

type PageRow = {
  id: string
  tenant_id: string
  site_id: string
  kind: KnowledgeKind
  parent_id: string | null
  title: string
  slug: string
  body: string
  visibility: 'public' | 'private'
  published_title: string | null
  published_body: string | null
  revision: number
  deleted: number
  updated_at: string
}
export class KnowledgeUnavailable extends Error {
  readonly status: number
  constructor(authenticated: boolean) {
    super('Content is unavailable.')
    this.status = authenticated ? 403 : 404
  }
}
const hiddenAncestor = `EXISTS(SELECT 1 FROM vc_knowledge_ancestry a JOIN vc_knowledge_pages ancestor ON ancestor.id=a.ancestor_id WHERE a.descendant_id=p.id AND (ancestor.deleted=1 OR ancestor.published_body IS NULL))`
const privateAncestor = `EXISTS(SELECT 1 FROM vc_knowledge_ancestry a JOIN vc_knowledge_pages ancestor ON ancestor.id=a.ancestor_id WHERE a.descendant_id=p.id AND ancestor.visibility='private')`
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/

export class KnowledgeRepository {
  constructor(
    private db: D1Database,
    private actor: number | null,
  ) {}
  private async scope(site: string, kind: KnowledgeKind, history = false) {
    if (
      !idPattern.test(site) ||
      !['wiki', 'intranet'].includes(kind) ||
      !(await tenantAuthorityActive(this.db, site))
    )
      throw new KnowledgeUnavailable(!!this.actor)
    if (!this.actor) {
      const website = kind === 'wiki' && (await publicWebsite(this.db, site))
      if (!website || !(await featureAvailableAt(this.db, site, kind)))
        throw new KnowledgeUnavailable(false)
      const after = await publicWebsite(this.db, site)
      if (!after || after.authority_revision !== website.authority_revision)
        throw new KnowledgeUnavailable(false)
      if (history) throw new KnowledgeUnavailable(false)
      return {
        tenant: website.organization_id,
        revision: website.authority_revision,
        privateRead: false,
        history: false,
        permission: 'wiki:read-published' as Permission,
      }
    }
    const repo = new TenantRepository(this.db, this.actor),
      snapshot = await repo.snapshot(site)
    const can = (permission: Permission) =>
      evaluateTenantPermission(snapshot.policy, {
        site,
        permission,
        featureAvailable: effectiveFeature(snapshot.features, site, kind).available,
      }).allowed
    const permission: Permission = history
      ? `${kind}:read-history`
      : kind === 'wiki'
        ? 'wiki:read-published'
        : 'intranet:read'
    if (!can(permission)) throw new KnowledgeUnavailable(true)
    return {
      tenant: snapshot.policy.tenant,
      revision: snapshot.revision,
      privateRead: kind === 'intranet' || can('wiki:read-private'),
      history,
      permission,
    }
  }
  private predicate(scope: { privateRead: boolean; history: boolean }) {
    return `p.deleted=0${scope.history ? '' : ` AND NOT ${hiddenAncestor}`}${scope.privateRead ? '' : ` AND NOT ${privateAncestor}`}`
  }
  private async finish<T>(
    site: string,
    scope: Awaited<ReturnType<KnowledgeRepository['scope']>>,
    resource: string,
    fetch: () => Promise<T>,
  ) {
    if (this.actor)
      return new TenantRepository(this.db, this.actor).read(
        { site, permission: scope.permission, resource },
        async () => {
          const result = await fetch()
          await this.confirm(scope.tenant, scope.revision)
          return result
        },
      )
    const result = await fetch()
    await this.confirm(scope.tenant, scope.revision)
    return result
  }
  private async confirm(tenant: string, revision: number) {
    const current = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(tenant)
      .first<{ authority_revision: number }>()
    if (current?.authority_revision !== revision) throw new SiteConflictError()
  }
  async list(
    site: string,
    kind: KnowledgeKind,
    options: { search?: string; after?: string; history?: boolean } = {},
  ) {
    const scope = await this.scope(site, kind, options.history),
      search = (options.search || '').trim().slice(0, 200),
      after = options.after || ''
    return this.finish(site, scope, `${kind}:listing`, async () => {
      const title = scope.history ? 'p.title' : 'p.published_title'
      const body = scope.history ? 'p.body' : 'p.published_body'
      const rows = await this.db
        .prepare(
          `SELECT p.id,p.parent_id AS parent,p.slug,${title} AS title,p.visibility,p.revision,p.published_body IS NOT NULL AS published FROM vc_knowledge_pages p WHERE p.site_id=? AND p.kind=? AND p.id>? AND ${this.predicate(scope)} AND (?='' OR instr(lower(${title}),lower(?))>0 OR EXISTS(SELECT 1 FROM json_tree(${body}) text_node WHERE text_node.key='text' AND text_node.type='text' AND instr(lower(text_node.value),lower(?))>0)) ORDER BY p.id LIMIT 101`,
        )
        .bind(site, kind, after, search, search, search)
        .all()
      const docs = rows.results.slice(0, 100)
      return { docs, next: rows.results.length > 100 ? String(docs.at(-1)?.id) : null }
    })
  }
  async get(site: string, kind: KnowledgeKind, id: string, history = false) {
    const scope = await this.scope(site, kind, history)
    return this.finish(site, scope, `${kind}:${id}`, async () => {
      const row = await this.db
        .prepare(
          `SELECT p.* FROM vc_knowledge_pages p WHERE p.site_id=? AND p.kind=? AND p.id=? AND ${this.predicate(scope)}`,
        )
        .bind(site, kind, id)
        .first<PageRow>()
      if (!row) throw new KnowledgeUnavailable(!!this.actor)
      const attachments = (
        await this.db
          .prepare(
            'SELECT id,filename,mime_type AS mimeType,size FROM vc_knowledge_attachments WHERE page_id=? AND deleted=0 ORDER BY created_at,id',
          )
          .bind(row.id)
          .all()
      ).results
      return {
        id: row.id,
        parent: row.parent_id,
        title: history ? row.title : row.published_title,
        slug: row.slug,
        body: JSON.parse(history ? row.body : row.published_body!),
        visibility: row.visibility,
        revision: row.revision,
        published: !!row.published_body,
        attachments,
      }
    })
  }
  async versions(site: string, kind: KnowledgeKind, id: string) {
    await this.get(site, kind, id, true)
    const scope = await this.scope(site, kind, true)
    return this.finish(site, scope, `${kind}:${id}:history`, async () =>
      (
        await this.db
          .prepare(
            'SELECT id,revision,title,body,action,created_at AS createdAt FROM vc_knowledge_versions WHERE page_id=? ORDER BY revision DESC LIMIT 100',
          )
          .bind(id)
          .all()
      ).results.map((row) => ({ ...row, body: JSON.parse(String(row.body)) })),
    )
  }
  async save(input: {
    site: string
    kind: KnowledgeKind
    id: string
    parent: string | null
    title: string
    slug: string
    body: unknown
    visibility: 'public' | 'private'
    expectedRevision: number
    operationKey: string
    action: 'save' | 'publish' | 'unpublish' | 'delete'
  }) {
    if (!this.actor) throw new KnowledgeUnavailable(false)
    if (
      !idPattern.test(input.id) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      !['save', 'publish', 'unpublish', 'delete'].includes(input.action)
    )
      throw Error('Choose a valid document revision.')
    if (
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 200 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) ||
      input.slug.length > 120
    )
      throw Error('Enter a title and a URL slug.')
    if (
      !['public', 'private'].includes(input.visibility) ||
      (input.kind === 'intranet' && input.visibility !== 'private')
    )
      throw Error('Intranet pages must remain private.')
    const content = validateKnowledgeBody(input.body),
      repo = new TenantRepository(this.db, this.actor)
    const permission: Permission = `${input.kind}:${input.action === 'delete' ? 'delete' : input.action === 'publish' || input.action === 'unpublish' ? 'publish' : input.expectedRevision ? 'edit' : 'create'}`
    const authority = await repo.require(input.site, permission)
    if (!(await tenantAuthorityActive(this.db, input.site))) throw new KnowledgeUnavailable(true)
    const current = await this.db
      .prepare('SELECT * FROM vc_knowledge_pages WHERE id=? AND site_id=? AND kind=? AND deleted=0')
      .bind(input.id, input.site, input.kind)
      .first<PageRow>()
    if (input.expectedRevision && (!current || current.revision !== input.expectedRevision))
      throw new SiteConflictError()
    if (!input.expectedRevision && (current || input.action !== 'save'))
      throw new SiteConflictError()
    if (current) await this.get(input.site, input.kind, input.id, true)
    if (
      current
        ? current.parent_id !== input.parent ||
          current.visibility !== input.visibility ||
          current.slug !== input.slug
        : input.parent !== null || input.visibility !== 'private'
    )
      await repo.require(input.site, `${input.kind}:manage-hierarchy`)
    if (input.parent) await this.get(input.site, input.kind, input.parent, true)
    const changingContent =
      current && (current.title !== input.title.trim() || current.body !== content.body)
    if (changingContent) await repo.require(input.site, `${input.kind}:edit`)
    const now = new Date().toISOString(),
      revision = input.expectedRevision + 1
    const publishedTitle =
      input.action === 'publish'
        ? input.title.trim()
        : input.action === 'unpublish'
          ? null
          : (current?.published_title ?? null)
    const publishedBody =
      input.action === 'publish'
        ? content.body
        : input.action === 'unpublish'
          ? null
          : (current?.published_body ?? null)
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(input)),
    )
    const guard = `${input.operationKey}:knowledge`
    return atomicSiteMutation(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
        '',
      ),
      write: current
        ? this.db
            .prepare(
              'UPDATE vc_knowledge_pages SET parent_id=?,title=?,slug=?,body=?,visibility=?,published_title=?,published_body=?,deleted=?,revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=?',
            )
            .bind(
              input.parent,
              input.title.trim(),
              input.slug,
              content.body,
              input.visibility,
              publishedTitle,
              publishedBody,
              input.action === 'delete' ? 1 : 0,
              now,
              input.id,
              input.site,
              input.expectedRevision,
            )
        : this.db
            .prepare(
              'INSERT INTO vc_knowledge_pages(id,tenant_id,site_id,kind,parent_id,title,slug,body,visibility,creator_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              input.id,
              authority.tenant,
              input.site,
              input.kind,
              input.parent,
              input.title.trim(),
              input.slug,
              content.body,
              input.visibility,
              this.actor,
              now,
            ),
      afterWrite: [
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,COUNT(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
          )
          .bind(guard, authority.tenant, authority.revision + 1),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
        this.db
          .prepare(
            'INSERT INTO vc_knowledge_versions(id,page_id,revision,title,body,actor_id,action,created_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            input.id,
            revision,
            input.title.trim(),
            content.body,
            this.actor,
            input.action,
            now,
          ),
        this.db
          .prepare(
            'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            authority.tenant,
            input.site,
            this.actor,
            `knowledge.${input.action}`,
            input.kind,
            input.id,
            input.operationKey,
            now,
          ),
      ],
      result: { id: input.id, revision },
    })
  }
  async attachment(
    site: string,
    kind: KnowledgeKind,
    page: string,
    id: string,
    storage: R2Bucket,
    history = false,
  ) {
    await this.get(site, kind, page, history)
    const scope = await this.scope(site, kind, history)
    return this.finish(site, scope, `${kind}:${page}:attachment:${id}`, async () => {
      const file = await this.db
        .prepare(
          'SELECT object_key,filename,mime_type FROM vc_knowledge_attachments WHERE id=? AND page_id=? AND deleted=0',
        )
        .bind(id, page)
        .first<{ object_key: string; filename: string; mime_type: string }>()
      if (!file) throw new KnowledgeUnavailable(!!this.actor)
      const object = await storage.get(file.object_key)
      if (!object) throw new KnowledgeUnavailable(!!this.actor)
      return { object, filename: file.filename, mimeType: file.mime_type }
    })
  }
  async upload(site: string, kind: KnowledgeKind, page: string, file: File, storage: R2Bucket) {
    if (!this.actor) throw new KnowledgeUnavailable(false)
    const authority = await new TenantRepository(this.db, this.actor).require(site, `${kind}:edit`)
    await this.get(site, kind, page, true)
    if (file.size < 1 || file.size > 10 * 1024 * 1024) throw Error('Choose a file up to 10 MB.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!fileSignature(bytes, file.type))
      throw Error('Choose a supported PDF, image, text or CSV file.')
    const id = crypto.randomUUID(),
      key = `knowledge/${authority.tenant}/${page}/${id}`,
      guard = `${id}:attachment`
    await storage.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' } })
    try {
      await this.db.batch([
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,COUNT(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
          )
          .bind(guard, authority.tenant, authority.revision),
        this.db
          .prepare(
            'INSERT INTO vc_knowledge_attachments(id,page_id,object_key,filename,mime_type,size,created_at) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(
            id,
            page,
            key,
            safeFilename(file.name),
            file.type,
            file.size,
            new Date().toISOString(),
          ),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
        this.db
          .prepare(
            'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            authority.tenant,
            site,
            this.actor,
            'knowledge.attachment-uploaded',
            kind,
            page,
            id,
            new Date().toISOString(),
          ),
      ])
    } catch (error) {
      await storage.delete(key)
      throw error
    }
    return { id, filename: safeFilename(file.name), size: file.size }
  }
}
