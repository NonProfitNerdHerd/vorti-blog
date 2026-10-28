import { APIError, createLocalReq, type PayloadRequest } from 'payload'
import { cmsDatabase, cmsSiteContext } from '../organizations/cms-scope'
import { TenantRepository } from '../organizations/tenant-repository'
import { atomicSiteMutation, SiteConflictError } from '../organizations/atomic'
import type { Permission } from '../organizations/permission-catalog'
import { CMS_AUDIENCE, type Audience } from './readership'
import { publishingDigest } from './legacy-content'
import { appendPublishingVersion } from './native-version'

type Collection = 'posts' | 'pages'
type Row = Record<string, string | number | null>
type Transfer = { site: string; collection: Collection; id: number; destination: Audience; mode: 'copy' | 'move'; slug: string;
  expectedRevision: string; expectedAuthorityRevision: number; key: string }
const identifier = (value: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw Error('Unsupported publishing schema.')
  return `"${value}"`
}

/** Copy/move is one guarded database operation. Ordinary collection updates never
 * gain an audience-switch escape hatch or a partially-created destination.
 */
export class PublishingTransfers {
  private db: D1Database
  private actor: number
  private authority: TenantRepository
  constructor(private req: PayloadRequest) {
    if (!req.user) throw new APIError('Sign in to copy or move content.', 401)
    this.db = cmsDatabase(req); this.actor = Number(req.user.id)
    this.authority = new TenantRepository(this.db, this.actor)
  }
  private async permission(site: string, audience: Audience, collection: Collection, action: string) {
    return this.authority.require(site, `${audience === 'intranet' ? 'intranet' : collection}:${action}` as Permission)
  }
  async read(site: string, collection: Collection, id: number) {
    if (!['posts', 'pages'].includes(collection) || !Number.isSafeInteger(id) || id < 1) throw new APIError('Content unavailable.', 404)
    const row = await this.db.prepare(`SELECT * FROM ${identifier(collection)} WHERE id=? AND platform_site=?`).bind(id, site).first<Row>()
    if (!row || !['public', 'intranet'].includes(String(row.audience))) throw new APIError('Content unavailable.', 404)
    const audience = row.audience as Audience
    const authority = await this.permission(site, audience, collection, 'read-history')
    const local = await createLocalReq({ user: this.req.user, context: { ...cmsSiteContext(site), [CMS_AUDIENCE]: audience } }, this.req.payload)
    // Native access includes current readership and ancestors, even with history.
    await this.req.payload.findByID({ collection, id, req: local, draft: true, depth: 0, overrideAccess: false })
    const latest = await this.db.prepare(`SELECT * FROM ${identifier(`_${collection}_v`)} WHERE parent_id=? ORDER BY latest DESC,id DESC LIMIT 1`).bind(id).first<Row>()
    const revision = await publishingDigest({ site, collection, id, identity: row.publishing_identity, updatedAt: row.updated_at, latest: latest?.id ?? null, versionUpdatedAt: latest?.updated_at ?? null })
    await this.authority.assertRevision(authority.tenant, authority.revision)
    return { row, latest, revision, authorityRevision: authority.revision, tenant: authority.tenant, audience }
  }
  async execute(input: Transfer) {
    if (!['public', 'intranet'].includes(input.destination) || !['copy', 'move'].includes(input.mode) ||
      !/^[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*$/u.test(input.slug) || input.slug.length > 180 || !/^[a-f0-9]{64}$/.test(input.expectedRevision) ||
      !Number.isSafeInteger(input.expectedAuthorityRevision) || !/^[a-zA-Z0-9_-]{16,128}$/.test(input.key)) throw new APIError('Choose valid copy or move details.', 400)
    if (!['posts', 'pages'].includes(input.collection) || !Number.isSafeInteger(input.id) || input.id < 1) throw new APIError('Content unavailable.', 404)
    await this.permission(input.site, input.destination, input.collection, 'create')
    const fingerprint = await publishingDigest(input)
    const replay = await this.db.prepare('SELECT actor_id,fingerprint,result FROM vc_platform_operations WHERE operation_key=?').bind(input.key).first<{ actor_id: number; fingerprint: string; result: string }>()
    if (replay) {
      if (replay.actor_id !== this.actor || replay.fingerprint !== fingerprint) throw new SiteConflictError()
      return JSON.parse(replay.result) as Record<string, unknown>
    }
    const source = await this.read(input.site, input.collection, input.id)
    if (source.audience === input.destination) throw new APIError('Choose the other publishing area.', 400)
    if (source.revision !== input.expectedRevision || source.authorityRevision !== input.expectedAuthorityRevision) throw new SiteConflictError()
    if (input.mode === 'move') {
      await this.permission(input.site, source.audience, input.collection, 'edit')
      if (source.row._status === 'published') await this.permission(input.site, source.audience, input.collection, 'publish')
      if (input.collection === 'pages') {
        if (await this.db.prepare('SELECT 1 FROM pages WHERE parent_id=? LIMIT 1').bind(input.id).first())
          throw new APIError('Move or reparent child Pages first. This move cannot leave children in another publishing area.', 409)
        if (await this.db.prepare(`SELECT 1 FROM vc_scoped_settings WHERE scope=? AND (
          CAST(json_extract(value,'$.homepage') AS INTEGER)=? OR CAST(json_extract(value,'$.privacyPolicyPage') AS INTEGER)=? OR
          CAST(json_extract(value,'$.blogPage') AS INTEGER)=? OR CAST(json_extract(value,'$.intranetHomepage') AS INTEGER)=?)`).bind(`site:${input.site}`, input.id, input.id, input.id, input.id).first())
          throw new APIError('Choose replacement homepage and privacy settings before moving this Page.', 409)
      }
    }
    const collision = await this.db.prepare(`SELECT 1 FROM ${identifier(input.collection)} WHERE platform_site=? AND audience=? AND slug=?`).bind(input.site, input.destination, input.slug).first()
    if (collision) throw new APIError('That slug already exists in the destination. Choose another slug.', 409)
    const columns = await this.db.prepare(`PRAGMA table_info(${identifier(input.collection)})`).all<{ name: string }>()
    const versionColumns = new Set(Object.keys(source.latest || {}))
    const now = new Date().toISOString(), epoch = source.authorityRevision + 1
    const hasSequences = await this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").first()
    const sequence = hasSequences ? await this.db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').bind(input.collection).first<{ seq: number }>() : null
    const highest = await this.db.prepare(`SELECT COALESCE(MAX(id),0) id FROM ${identifier(input.collection)}`).first<{ id: number }>()
    const destinationID = input.mode === 'move' ? input.id : Math.max(Number(sequence?.seq || 0), Number(highest?.id || 0)) + 1
    const overrides: Row = { id: destinationID, audience: input.destination, slug: input.slug, _status: 'draft', published_at: null, publishing_published_at: null,
      updated_at: now, platform_write_actor: this.actor, platform_write_epoch: epoch, publishing_operation_key: input.key,
      publishing_readership: 'site', publishing_people: '[]', publishing_groups: '[]',
      ...(input.mode === 'copy' ? { created_at: now, publishing_identity: crypto.randomUUID(), publishing_owner: this.actor, publishing_lineage: `copy:${input.collection}:${input.id}` } : {}),
      ...(input.collection === 'pages' ? { parent_id: null, publishing_archived: 0 } : {}) }
    const values: unknown[] = []
    const expression = (name: string) => {
      if (Object.hasOwn(overrides, name)) { values.push(overrides[name]); return '?' }
      if (versionColumns.has(`version_${name}`)) return `v.${identifier(`version_${name}`)}`
      return `s.${identifier(name)}`
    }
    const names = columns.results.map(column => column.name), table = identifier(input.collection), versions = identifier(`_${input.collection}_v`)
    const assignments = names.filter(name => name !== 'id').map(name => `${identifier(name)}=${expression(name)}`)
    const statement = input.mode === 'move'
      ? this.db.prepare(`UPDATE ${table} AS target SET ${assignments.join(',')} FROM ${table} s LEFT JOIN ${versions} v ON v.id=? WHERE target.id=s.id AND s.id=? AND s.updated_at=? AND s.publishing_identity=?`).bind(...values, source.latest?.id || 0, input.id, source.row.updated_at, source.row.publishing_identity)
      : (() => {
        values.length = 0
        const expressions = names.map(expression)
        return this.db.prepare(`INSERT INTO ${table}(${names.map(identifier).join(',')}) SELECT ${expressions.join(',')} FROM ${table} s LEFT JOIN ${versions} v ON v.id=? WHERE s.id=? AND s.updated_at=? AND s.publishing_identity=?`).bind(...values, source.latest?.id || 0, input.id, source.row.updated_at, source.row.publishing_identity)
      })()
    const statements: D1PreparedStatement[] = [
      this.db.prepare(`INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN COALESCE((SELECT id FROM ${versions} WHERE parent_id=? ORDER BY latest DESC,id DESC LIMIT 1),0)=? THEN 1 ELSE 0 END`).bind(`${input.key}:version`, input.id, source.latest?.id || 0),
      this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(`${input.key}:version`), statement,
      this.db.prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())').bind(`${input.key}:document`),
      this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(`${input.key}:document`),
    ]
    if (input.mode === 'move' && source.audience === 'intranet') {
      // Public membership must not make formerly private history site-wide.
      // Retain the last internal readership for every archived internal version;
      // group membership remains live rather than copied into reader grants.
      const parent = input.collection === 'pages' && source.row.parent_id ? await this.db.prepare('SELECT created_at,publishing_identity FROM pages WHERE id=? AND platform_site=?').bind(source.row.parent_id, input.site).first<{ created_at: string; publishing_identity: string }>() : null
      statements.push(this.db.prepare(`INSERT INTO vc_publishing_private_history(collection,document_id,tenant_id,site_id,readership,owner_id,people,groups,parent_id,parent_created_at,parent_identity,document_created_at,document_identity,published,published_at,operation_key,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(collection,document_id) DO UPDATE SET readership=excluded.readership,owner_id=excluded.owner_id,people=excluded.people,groups=excluded.groups,
        parent_id=excluded.parent_id,parent_created_at=excluded.parent_created_at,parent_identity=excluded.parent_identity,document_created_at=excluded.document_created_at,document_identity=excluded.document_identity,published=excluded.published,published_at=excluded.published_at,operation_key=excluded.operation_key,updated_at=excluded.updated_at`)
        .bind(input.collection, input.id, source.tenant, input.site, source.row.publishing_readership, source.row.publishing_owner, source.row.publishing_people, source.row.publishing_groups,
          input.collection === 'pages' ? source.row.parent_id : null, parent?.created_at || null, parent?.publishing_identity || null, source.row.created_at, source.row.publishing_identity, Number(source.row._status === 'published'), source.row.publishing_published_at, input.key, now))
    }
    if (input.collection === 'posts') {
      if (input.mode === 'move') statements.push(this.db.prepare('DELETE FROM posts_rels WHERE parent_id=?').bind(input.id))
      const origin = source.latest ? '_posts_v_rels' : 'posts_rels'
      statements.push(this.db.prepare(`INSERT INTO posts_rels("order",parent_id,path,categories_id,tags_id) SELECT "order",?,${source.latest ? "substr(path,9)" : 'path'},categories_id,tags_id FROM ${identifier(origin)} WHERE parent_id=?`).bind(destinationID, source.latest?.id || input.id))
    } else {
      if (input.mode === 'move') statements.push(this.db.prepare('DELETE FROM pages_breadcrumbs WHERE _parent_id=?').bind(input.id))
      statements.push(this.db.prepare('INSERT INTO pages_breadcrumbs(id,_order,_parent_id,doc_id,url,label) VALUES(?,1,?,?,?,?)').bind(input.key, destinationID, destinationID, `/${input.slug}`, source.latest?.version_title ?? source.row.title))
    }
    statements.push(...await appendPublishingVersion(this.db, { collection: input.collection, id: destinationID, key: input.key, now, actor: this.actor, epoch }))
    statements.push(this.db.prepare(`INSERT INTO vc_publishing_transfer_operations(operation_key,actor_id,site_id,source_collection,source_id,destination_audience,mode,source_revision,state,destination_id,created_at) VALUES(?,?,?,?,?,?,?,?,'completed',?,?)`)
      .bind(input.key, this.actor, input.site, input.collection, input.id, input.destination, input.mode, source.revision, destinationID, now),
      this.db.prepare(`INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,before_value,after_value,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), source.tenant, input.site, this.actor, `publishing.${input.mode}`, input.collection, String(input.id), JSON.stringify({ audience: source.audience }), JSON.stringify({ audience: input.destination, destination: destinationID, status: 'draft' }), input.key, now))
    return atomicSiteMutation(this.db, { actor: this.actor, operationKey: input.key, fingerprint,
      write: this.db.prepare('UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=? AND authority_revision=?').bind(source.tenant, source.authorityRevision),
      afterWrite: statements, result: { id: destinationID, collection: input.collection, audience: input.destination, status: 'draft', reviewDependencies: true } })
  }
}
