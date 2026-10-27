import { atomicSiteMutation, SiteConflictError } from '../organizations/atomic'
import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { requireCRMAction } from './tenant-actions'
import {
  contactLabel,
  validateContactProfile,
  validateRoles,
  validateContactTags,
  type ContactProfile,
  type ConstituentRole,
} from './contact-model'

interface ConstituentRow {
  id: string
  organization_id: string
  source_site_id: string
  kind: string
  label: string
  profile: string
  revision: number
  archived: number
}
interface ContactRow extends ConstituentRow {
  affiliation_id: string
  affiliation_revision: number
  roles: string
  tags: string
}
export interface ContactSummary {
  id: string
  label: string
  kind: string
  revision: number
  affiliationRevision: number
  roles: ConstituentRole[]
  tags: string[]
}
export interface ContactCorrection {
  id: string
  message: string
  status: 'open' | 'resolved' | 'declined'
  revision: number
  createdAt: string
  actorLabel: string
}
function summary(row: ContactRow): ContactSummary {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    revision: row.revision,
    affiliationRevision: row.affiliation_revision,
    roles: JSON.parse(row.roles),
    tags: JSON.parse(row.tags),
  }
}
async function digest(value: unknown): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}
export class ContactRepository {
  private readonly authority: OrganizationRepository
  constructor(
    private readonly db: D1Database,
    private readonly actor: number,
    private readonly commit: typeof atomicSiteMutation = atomicSiteMutation,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async confirmRead(organization: string, revision: number): Promise<void> {
    const current = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(organization)
      .first<{ authority_revision: number }>()
    if (current?.authority_revision !== revision) throw new SiteAccessError()
  }
  private fence(key: string, organization: string, revision: number): D1PreparedStatement[] {
    return [
      this.db
        .prepare(
          'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
        )
        .bind(`${key}:authority`, organization, revision),
      this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(`${key}:authority`),
    ]
  }
  private audit(
    key: string,
    organization: string,
    site: string,
    id: string,
    action: string,
    before: unknown,
    after: unknown,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,before_value,after_value,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        crypto.randomUUID(),
        organization,
        site,
        this.actor,
        action,
        'constituent',
        id,
        before == null ? null : JSON.stringify(before),
        after == null ? null : JSON.stringify(after),
        key,
        new Date().toISOString(),
      )
  }
  async create(input: {
    site: string
    profile: unknown
    roles: unknown
    tags?: unknown
    operationKey: string
  }): Promise<Record<string, unknown>> {
    const site = await this.authority.require(input.site, 'identity', 'edit')
    await requireCRMAction(this.db, this.actor, input.site, 'crm:create', site.authorityRevision)
    const profile = validateContactProfile(input.profile),
      roles = validateRoles(input.roles),
      tags = validateContactTags(input.tags === undefined ? [] : input.tags)
    const id = crypto.randomUUID(),
      affiliation = crypto.randomUUID(),
      now = new Date().toISOString()
    return this.commit(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: await digest({ action: 'contact.create', site: site.id, profile, roles, tags }),
      write: this.db
        .prepare(
          'INSERT INTO vc_crm_constituents(id,organization_id,source_site_id,kind,label,profile,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          site.organization_id,
          site.id,
          profile.kind,
          contactLabel(profile),
          JSON.stringify(profile),
          this.actor,
          now,
          now,
        ),
      afterWrite: [
        ...this.fence(input.operationKey, site.organization_id, site.authorityRevision),
        this.db
          .prepare(
            'INSERT INTO vc_crm_affiliations(id,organization_id,site_id,constituent_id,roles,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .bind(
            affiliation,
            site.organization_id,
            site.id,
            id,
            JSON.stringify(roles),
            JSON.stringify(tags),
            now,
            now,
          ),
        this.audit(input.operationKey, site.organization_id, site.id, id, 'contact.created', null, {
          profile,
          roles,
          tags,
        }),
      ],
      result: { id, site: site.id, revision: 1 },
    })
  }
  private async row(site: string, id: string): Promise<ContactRow> {
    const row = await this.db
      .prepare(
        `SELECT c.*,a.id AS affiliation_id,a.revision AS affiliation_revision,a.roles,a.tags
      FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.organization_id=c.organization_id
      WHERE a.site_id=? AND c.id=? AND a.archived=0 AND c.archived=0`,
      )
      .bind(site, id)
      .first<ContactRow>()
    if (!row) throw new SiteAccessError()
    return row
  }
  async get(
    site: string,
    id: string,
  ): Promise<
    ContactSummary & { profile: ContactProfile; canEditProfile: boolean; canEditChapter: boolean }
  > {
    const context = await this.authority.require(site, 'identity', 'read')
    const row = await this.row(site, id)
    const canEditProfile = (await this.authority.authority(row.source_site_id, 'identity', 'edit'))
      .allowed
    const canEditChapter = (await this.authority.authority(site, 'identity', 'edit')).allowed
    await this.confirmRead(context.organization_id, context.authorityRevision)
    return {
      ...summary(row),
      profile: validateContactProfile(JSON.parse(row.profile)),
      canEditProfile,
      canEditChapter,
    }
  }
  async list(input: {
    site: string
    search?: string
    role?: ConstituentRole
    limit?: number
    after?: { label: string; id: string }
  }): Promise<{
    docs: ContactSummary[]
    total: number
    next: { label: string; id: string } | null
  }> {
    const site = await this.authority.require(input.site, 'identity', 'read')
    const search = (input.search || '').trim()
    if (new TextEncoder().encode(search).length > 40)
      throw new Error('Search must be at most 40 UTF-8 bytes.')
    if (input.role && validateRoles([input.role]).length !== 1)
      throw new Error('Choose a valid role.')
    const limit = input.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Choose between 1 and 100 rows.')
    if (
      input.after &&
      (typeof input.after.id !== 'string' ||
        typeof input.after.label !== 'string' ||
        input.after.id.length > 80 ||
        input.after.label.length > 250)
    )
      throw new Error('Invalid page cursor.')
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
    if (new TextEncoder().encode(pattern).length > 50)
      throw new Error('Search contains too many wildcard characters.')
    const where = `a.site_id=? AND c.organization_id=? AND a.archived=0 AND c.archived=0
      AND (c.label LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM json_each(c.profile,'$.methods') method WHERE json_extract(method.value,'$.kind')='email' AND json_extract(method.value,'$.value') LIKE ? ESCAPE '\\')) ${input.role ? 'AND EXISTS(SELECT 1 FROM json_each(a.roles) r WHERE r.value=?)' : ''}`
    const parameters: Array<string | number> = [
      site.id,
      site.organization_id,
      pattern,
      pattern,
      ...(input.role ? [input.role] : []),
    ]
    const total = await this.db
      .prepare(
        `SELECT count(*) AS total FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id WHERE ${where}`,
      )
      .bind(...parameters)
      .first<{ total: number }>()
    const cursor = input.after
      ? 'AND(c.label COLLATE NOCASE>? OR(c.label COLLATE NOCASE=? AND c.id>?))'
      : ''
    const rows = await this.db
      .prepare(
        `SELECT c.*,a.id AS affiliation_id,a.revision AS affiliation_revision,a.roles,a.tags FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id WHERE ${where} ${cursor} ORDER BY c.label COLLATE NOCASE,c.id LIMIT ?`,
      )
      .bind(
        ...parameters,
        ...(input.after ? [input.after.label, input.after.label, input.after.id] : []),
        limit + 1,
      )
      .all<ContactRow>()
    const page = rows.results.slice(0, limit),
      last = page.at(-1)
    await this.confirmRead(site.organization_id, site.authorityRevision)
    return {
      docs: page.map(summary),
      total: total?.total || 0,
      next: rows.results.length > limit && last ? { label: last.label, id: last.id } : null,
    }
  }
  async updateProfile(input: {
    site: string
    id: string
    expectedRevision: number
    confirmedSharedUpdate: boolean
    profile: unknown
    operationKey: string
  }): Promise<Record<string, unknown>> {
    const context = await this.authority.require(input.site, 'identity', 'read')
    const original = await this.row(input.site, input.id)
    const source = await this.authority.require(original.source_site_id, 'identity', 'edit')
    await requireCRMAction(
      this.db,
      this.actor,
      original.source_site_id,
      'crm:edit',
      source.authorityRevision,
    )
    if (source.authorityRevision !== context.authorityRevision) throw new SiteConflictError()
    if (source.organization_id !== context.organization_id || input.confirmedSharedUpdate !== true)
      throw new Error('Confirm that this updates the shared contact profile.')
    const profile = validateContactProfile(input.profile)
    if (profile.kind !== original.kind)
      throw new Error('Create a separate constituent to change Person/Organization identity type.')
    return this.commit(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: await digest({
        action: 'contact.profile.update',
        site: input.site,
        id: input.id,
        revision: input.expectedRevision,
        profile,
      }),
      write: this.db
        .prepare(
          'UPDATE vc_crm_constituents SET label=?,profile=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0',
        )
        .bind(
          contactLabel(profile),
          JSON.stringify(profile),
          new Date().toISOString(),
          input.id,
          input.expectedRevision,
        ),
      afterWrite: [
        ...this.fence(input.operationKey, source.organization_id, source.authorityRevision),
        this.audit(
          input.operationKey,
          source.organization_id,
          context.id,
          input.id,
          'contact.profile.updated',
          JSON.parse(original.profile),
          profile,
        ),
      ],
      result: { id: input.id, site: input.site, revision: input.expectedRevision + 1 },
    })
  }
  async updateChapter(input: {
    site: string
    id: string
    expectedRevision: number
    roles: unknown
    tags: unknown
    operationKey: string
  }): Promise<Record<string, unknown>> {
    const site = await this.authority.require(input.site, 'identity', 'edit')
    await requireCRMAction(this.db, this.actor, input.site, 'crm:edit', site.authorityRevision)
    const original = await this.row(site.id, input.id)
    const roles = validateRoles(input.roles),
      tags = validateContactTags(input.tags)
    return this.commit(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: await digest({
        action: 'contact.chapter.update',
        site: site.id,
        id: input.id,
        revision: input.expectedRevision,
        roles,
        tags,
      }),
      write: this.db
        .prepare(
          'UPDATE vc_crm_affiliations SET roles=?,tags=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0',
        )
        .bind(
          JSON.stringify(roles),
          JSON.stringify(tags),
          new Date().toISOString(),
          original.affiliation_id,
          input.expectedRevision,
        ),
      afterWrite: [
        ...this.fence(input.operationKey, site.organization_id, site.authorityRevision),
        this.audit(
          input.operationKey,
          site.organization_id,
          site.id,
          input.id,
          'contact.chapter.updated',
          { roles: JSON.parse(original.roles), tags: JSON.parse(original.tags) },
          { roles, tags },
        ),
      ],
      result: { id: input.id, site: site.id, affiliationRevision: input.expectedRevision + 1 },
    })
  }
  async corrections(input: {
    site: string
    id: string
    before?: { createdAt: string; id: string }
  }): Promise<{
    docs: ContactCorrection[]
    total: number
    next: { createdAt: string; id: string } | null
    canResolve: boolean
  }> {
    const context = await this.authority.require(input.site, 'identity', 'read')
    await this.authority.require(input.site, 'communications', 'read')
    const contact = await this.row(input.site, input.id)
    if (
      input.before &&
      (typeof input.before.createdAt !== 'string' ||
        input.before.createdAt.length > 40 ||
        typeof input.before.id !== 'string' ||
        input.before.id.length > 80)
    )
      throw new Error('Invalid page cursor.')
    const cursor = input.before ? 'AND(r.created_at<? OR(r.created_at=? AND r.id<?))' : ''
    const rows = await this.db
      .prepare(
        `SELECT r.id,r.message,r.status,r.revision,r.created_at,COALESCE(u.attribution_label,'Account #'||r.actor_id) AS actor_label FROM vc_crm_corrections r LEFT JOIN users u ON u.id=r.actor_id WHERE r.site_id=? AND r.constituent_id=? ${cursor} ORDER BY r.created_at DESC,r.id DESC LIMIT 51`,
      )
      .bind(
        input.site,
        input.id,
        ...(input.before ? [input.before.createdAt, input.before.createdAt, input.before.id] : []),
      )
      .all<{
        id: string
        message: string
        status: ContactCorrection['status']
        revision: number
        created_at: string
        actor_label: string
      }>()
    const total = await this.db
      .prepare('SELECT count(*) AS n FROM vc_crm_corrections WHERE site_id=? AND constituent_id=?')
      .bind(input.site, input.id)
      .first<{ n: number }>()
    const docs = rows.results.slice(0, 50),
      last = docs.at(-1)
    const canResolve = (await this.authority.authority(contact.source_site_id, 'identity', 'edit'))
      .allowed
    await this.confirmRead(context.organization_id, context.authorityRevision)
    return {
      docs: docs.map((row) => ({
        id: row.id,
        message: row.message,
        status: row.status,
        revision: row.revision,
        createdAt: row.created_at,
        actorLabel: row.actor_label,
      })),
      total: total?.n || 0,
      next: rows.results.length > 50 && last ? { id: last.id, createdAt: last.created_at } : null,
      canResolve,
    }
  }
  async resolveCorrection(input: {
    site: string
    id: string
    correction: string
    expectedRevision: number
    status: 'resolved' | 'declined'
    reason: string
    operationKey: string
  }): Promise<Record<string, unknown>> {
    const identity = await this.authority.require(input.site, 'identity', 'read')
    const context = await this.authority.require(input.site, 'communications', 'read')
    if (identity.authorityRevision !== context.authorityRevision) throw new SiteAccessError()
    const contact = await this.row(input.site, input.id)
    const source = await this.authority.require(contact.source_site_id, 'identity', 'edit')
    await requireCRMAction(
      this.db,
      this.actor,
      contact.source_site_id,
      'crm:edit',
      source.authorityRevision,
    )
    if (source.authorityRevision !== context.authorityRevision) throw new SiteConflictError()
    if (
      !['resolved', 'declined'].includes(input.status) ||
      typeof input.reason !== 'string' ||
      !input.reason.trim() ||
      input.reason.length > 2000
    )
      throw new Error('Enter a review reason using at most 2,000 characters.')
    const original = await this.db
      .prepare(
        'SELECT status,revision FROM vc_crm_corrections WHERE id=? AND site_id=? AND constituent_id=?',
      )
      .bind(input.correction, context.id, input.id)
      .first<{ status: string; revision: number }>()
    if (!original) throw new SiteAccessError()
    return this.commit(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: await digest({
        action: 'contact.correction.review',
        site: context.id,
        contact: input.id,
        correction: input.correction,
        expectedRevision: input.expectedRevision,
        status: input.status,
        reason: input.reason.trim(),
      }),
      write: this.db
        .prepare(
          "UPDATE vc_crm_corrections SET status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='open'",
        )
        .bind(input.status, new Date().toISOString(), input.correction, input.expectedRevision),
      afterWrite: [
        ...this.fence(input.operationKey, source.organization_id, source.authorityRevision),
        this.audit(
          input.operationKey,
          source.organization_id,
          context.id,
          input.id,
          'contact.correction.reviewed',
          { correction: input.correction, ...original },
          { correction: input.correction, status: input.status, reason: input.reason.trim() },
        ),
      ],
      result: { id: input.correction, status: input.status, revision: input.expectedRevision + 1 },
    })
  }
  async requestCorrection(input: {
    site: string
    id: string
    message: string
    operationKey: string
  }): Promise<Record<string, unknown>> {
    const site = await this.authority.require(input.site, 'identity', 'read')
    await this.row(site.id, input.id)
    if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 4000)
      throw new Error('Describe the requested correction using at most 4,000 characters.')
    const id = crypto.randomUUID(),
      message = input.message.trim(),
      now = new Date().toISOString()
    return this.commit(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: await digest({
        action: 'contact.correction',
        site: site.id,
        id: input.id,
        message,
      }),
      write: this.db
        .prepare(
          'INSERT INTO vc_crm_corrections(id,site_id,constituent_id,actor_id,message,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(id, site.id, input.id, this.actor, message, now, now),
      afterWrite: [
        ...this.fence(input.operationKey, site.organization_id, site.authorityRevision),
        this.audit(
          input.operationKey,
          site.organization_id,
          site.id,
          input.id,
          'contact.correction.requested',
          null,
          { correction: id, message },
        ),
      ],
      result: { id, site: site.id },
    })
  }
}
