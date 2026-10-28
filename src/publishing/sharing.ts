import { APIError, type PayloadRequest } from 'payload'
import { atomicSiteMutation, SiteConflictError } from '../organizations/atomic'
import { cmsDatabase } from '../organizations/cms-scope'
import { TenantRepository } from '../organizations/tenant-repository'
import { authorizeInternalRecord } from './record-access'
import { audienceTablesV1 } from './audience-schema-v1'
import { appendPublishingVersion } from './native-version'

type RecordRow = { id: number; platform_site: string; audience: string; publishing_identity: string; publishing_readership: 'site' | 'restricted'; publishing_people: string; publishing_groups: string; updated_at: string; _status?: string }
const fingerprint = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('')

export class PublishingSharing {
  private db: D1Database
  private actor: number
  private authority: TenantRepository
  constructor(private readonly req: PayloadRequest) {
    if (!req.user) throw new APIError('Sign in to change sharing.', 401)
    this.db = cmsDatabase(req); this.actor = Number(req.user.id); this.authority = new TenantRepository(this.db, this.actor)
  }
  private mapping(collection: string) {
    const mapping = audienceTablesV1.find(([slug]) => slug === collection)
    if (!mapping || ['search', 'event-series', 'imports', 'exports'].includes(collection)) throw new APIError('Choose an authorable collection.', 400)
    return mapping
  }
  async read(site: string, collection: string, id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw new APIError('Content unavailable.', 404)
    const mapping = this.mapping(collection), authority = await this.authority.require(site, 'intranet:edit')
    await authorizeInternalRecord(this.req, collection, site, id)
    const row = await this.db.prepare(`SELECT * FROM "${mapping[1]}" WHERE id=? AND platform_site=? AND audience='intranet'`).bind(id, site).first<RecordRow>()
    if (!row) throw new APIError('Content unavailable.', 404)
    const latest = mapping[2] ? await this.db.prepare(`SELECT id,updated_at FROM "${mapping[2]}" WHERE parent_id=? AND latest=1 ORDER BY id DESC LIMIT 1`).bind(id).first<{ id: number; updated_at: string }>() : null
    const revision = await fingerprint({ collection, id, site, identity: row.publishing_identity, updatedAt: row.updated_at, version: latest?.id ?? null, versionUpdatedAt: latest?.updated_at ?? null })
    await this.authority.assertRevision(authority.tenant, authority.revision)
    return { readership: row.publishing_readership, people: JSON.parse(row.publishing_people) as number[], groups: JSON.parse(row.publishing_groups) as string[],
      revision, authorityRevision: authority.revision, published: row._status === 'published', row, latest, tenant: authority.tenant }
  }
  async save(input: { site: string; collection: string; id: number; readership: 'site' | 'restricted'; people: number[]; groups: string[]; expectedRevision: string; expectedAuthorityRevision: number; key: string }) {
    if (!['site', 'restricted'].includes(input.readership) || !Array.isArray(input.people) || input.people.length > 500 || input.people.some(id => !Number.isSafeInteger(id) || id < 1) ||
        !Array.isArray(input.groups) || input.groups.length > 100 || input.groups.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) || !/^[a-f0-9]{64}$/.test(input.expectedRevision) ||
        !Number.isSafeInteger(input.expectedAuthorityRevision) || input.expectedAuthorityRevision < 0 || !/^[a-zA-Z0-9_-]{16,128}$/.test(input.key)) throw new APIError('Select valid readership and recipients.', 400)
    const people = input.readership === 'restricted' ? [...new Set(input.people)].sort((a, b) => a - b) : []
    const groups = input.readership === 'restricted' ? [...new Set(input.groups)].sort() : []
    const value = { site: input.site, collection: input.collection, id: input.id, readership: input.readership, people, groups,
      expectedRevision: input.expectedRevision, expectedAuthorityRevision: input.expectedAuthorityRevision, key: input.key }, digest = await fingerprint(value)
    await this.authority.require(input.site, 'intranet:edit')
    const replay = await this.db.prepare('SELECT actor_id,fingerprint,result FROM vc_platform_operations WHERE operation_key=?').bind(input.key).first<{ actor_id: number; fingerprint: string; result: string }>()
    if (replay) {
      if (replay.actor_id !== this.actor || replay.fingerprint !== digest) throw new SiteConflictError()
      return JSON.parse(replay.result) as Record<string, unknown>
    }
    const current = await this.read(input.site, input.collection, input.id), mapping = this.mapping(input.collection)
    if (current.revision !== input.expectedRevision || current.authorityRevision !== input.expectedAuthorityRevision) throw new SiteConflictError()
    if (current.published) await this.authority.require(input.site, 'intranet:publish')
    const controls = { media: 'administration:media', categories: 'administration:categories', tags: 'administration:tags', menus: 'administration:menus', 'site-templates': 'administration:templates', 'saved-views': 'administration:saved-views' } as const
    if (Object.hasOwn(controls, input.collection)) await this.authority.require(input.site, controls[input.collection as keyof typeof controls])
    const now = new Date().toISOString(), epoch = current.authorityRevision + 1
    const statements: D1PreparedStatement[] = []
    for (let offset = 0; offset < people.length; offset += 75) {
      const ids = people.slice(offset, offset + 75), guard = `${input.key}:people:${offset}`
      statements.push(this.db.prepare(`INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN COUNT(*)=? THEN 1 ELSE 0 END
        FROM vc_tenant_memberships m WHERE tenant_id=? AND active=1 AND user_id IN(${ids.map(() => '?').join(',')})
        AND EXISTS(SELECT 1 FROM vc_tenant_user_sites permitted WHERE permitted.user_id=m.user_id AND permitted.site=?)
        AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=m.user_id AND a.disabled=1)`).bind(guard, ids.length, current.tenant, ...ids, input.site), this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard))
    }
    for (let offset = 0; offset < groups.length; offset += 75) {
      const ids = groups.slice(offset, offset + 75), guard = `${input.key}:groups:${offset}`
      statements.push(this.db.prepare(`INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN COUNT(*)=? THEN 1 ELSE 0 END FROM vc_publishing_groups
        WHERE tenant_id=? AND site_id=? AND retired=0 AND id IN(${ids.map(() => '?').join(',')})`).bind(guard, ids.length, current.tenant, input.site, ...ids), this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard))
    }
    statements.push(this.db.prepare(`UPDATE "${mapping[1]}" SET publishing_readership=?,publishing_people=?,publishing_groups=?,publishing_operation_key=?,platform_write_actor=?,platform_write_epoch=?,updated_at=?
      WHERE id=? AND platform_site=? AND audience='intranet' AND updated_at=? AND publishing_identity=?${mapping[2] ? ` AND COALESCE((SELECT id FROM "${mapping[2]}" WHERE parent_id=? AND latest=1 ORDER BY id DESC LIMIT 1),0)=?` : ''}`)
      .bind(input.readership, JSON.stringify(people), JSON.stringify(groups), input.key, this.actor, epoch, now, input.id, input.site, current.row.updated_at, current.row.publishing_identity, ...(mapping[2] ? [input.id, current.latest?.id || 0] : [])),
      this.db.prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())').bind(`${input.key}:record`),
      this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(`${input.key}:record`))
    statements.push(...await appendPublishingVersion(this.db, { collection: input.collection, id: input.id, key: input.key, now, actor: this.actor, epoch,
      sourceVersion: current.latest?.id, readership: input.readership, people, groups }))
    statements.push(this.db.prepare(`INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,before_value,after_value,operation_key,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), current.tenant, input.site, this.actor, 'publishing.share', input.collection, String(input.id),
        JSON.stringify({ readership: current.readership, people: current.people, groups: current.groups }), JSON.stringify({ readership: input.readership, people, groups }), input.key, now))
    return atomicSiteMutation(this.db, { actor: this.actor, operationKey: input.key, fingerprint: digest,
      write: this.db.prepare('UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=? AND authority_revision=?').bind(current.tenant, current.authorityRevision),
      afterWrite: statements, result: { id: input.id, updatedAt: now, authorityRevision: epoch } })
  }
}
