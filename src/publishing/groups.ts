import { atomicSiteMutation, SiteConflictError } from '../organizations/atomic'
import { TenantRepository, TenantPermissionError } from '../organizations/tenant-repository'
import { sitePath } from '../organizations/policy'
import { evaluateTenantPermission } from '../organizations/tenant-policy'

export class PublishingGroups {
  constructor(private readonly db: D1Database, private readonly actor: number) {}

  async canManage(site: string): Promise<boolean> {
    try { await this.administrator(site); return true }
    catch (error) { if (error instanceof TenantPermissionError) return false; throw error }
  }

  private async administrator(site: string) {
    const snapshot = await new TenantRepository(this.db, this.actor).snapshot(site)
    const { policy } = snapshot
    if (!policy.accountActive || !policy.membershipActive) throw new TenantPermissionError()
    if (!evaluateTenantPermission(policy, { site, permission: 'administration:assignments', featureAvailable: true }).allowed)
      throw new TenantPermissionError()
    const path = sitePath(policy.sites, site)
    if (path.some(node => node.archived || node.organization !== policy.tenant)) throw new TenantPermissionError()
    const allowed = policy.assignments.some(assignment => policy.roles.some(role =>
      role.id === assignment.role && role.tenant === policy.tenant && !role.retired &&
      ((role.builtin === 'tenant-administrator' && assignment.site === null) ||
       (role.builtin === 'site-administrator' && (assignment.site === site ||
         (assignment.descendants && path.some(node => node.id === assignment.site)))))))
    if (!allowed) throw new TenantPermissionError()
    return snapshot
  }

  async list(site: string) {
    const snapshot = await this.administrator(site)
    const rows = await this.db.prepare(`SELECT g.id,g.name,g.retired,g.revision,
      COALESCE((SELECT json_group_array(user_id) FROM vc_publishing_group_members m WHERE m.group_id=g.id),'[]') members
      FROM vc_publishing_groups g WHERE tenant_id=? AND site_id=? ORDER BY name`).bind(snapshot.policy.tenant, site).all<{
        id: string; name: string; retired: number; revision: number; members: string
      }>()
    await new TenantRepository(this.db, this.actor).assertRevision(snapshot.policy.tenant, snapshot.revision)
    return { authorityRevision: snapshot.revision, groups: rows.results.map(row => ({ ...row, members: JSON.parse(row.members) as number[] })) }
  }

  async save(input: { site: string; id: string; name: string; retired: boolean; members: number[]; expectedAuthorityRevision: number; key: string }) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.id) || !input.name.trim() || input.name.trim().length > 120 ||
        typeof input.retired !== 'boolean' || !Array.isArray(input.members) || input.members.length > 500 ||
        input.members.some(id => !Number.isSafeInteger(id) || id < 1)) throw Error('Enter valid sharing group details.')
    const snapshot = await this.administrator(input.site)
    const previous = await this.db.prepare('SELECT tenant_id,site_id FROM vc_publishing_groups WHERE id=?').bind(input.id).first<{ tenant_id: string; site_id: string }>()
    if (previous && (previous.tenant_id !== snapshot.policy.tenant || previous.site_id !== input.site)) throw new TenantPermissionError()
    const members = input.retired ? [] : [...new Set(input.members)].sort((a, b) => a - b)
    const value = { site: input.site, id: input.id, name: input.name.trim(), retired: input.retired, members,
      expectedAuthorityRevision: input.expectedAuthorityRevision, key: input.key }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    // Replays are resolved by the atomic operation receipt; a new operation requires
    // the exact authority revision originally displayed to the administrator.
    const replay = await this.db.prepare('SELECT actor_id,fingerprint,result FROM vc_platform_operations WHERE operation_key=?').bind(input.key).first<{ actor_id: number; fingerprint: string; result: string }>()
    if (replay) {
      if (replay.actor_id !== this.actor || replay.fingerprint !== fingerprint) throw new SiteConflictError()
      return JSON.parse(replay.result) as Record<string, unknown>
    }
    if (snapshot.revision !== input.expectedAuthorityRevision) throw new SiteConflictError()
    return atomicSiteMutation(this.db, {
      actor: this.actor, operationKey: input.key, fingerprint,
      write: this.db.prepare('UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=? AND authority_revision=?').bind(snapshot.policy.tenant, snapshot.revision),
      afterWrite: [
        this.db.prepare(`INSERT INTO vc_publishing_groups(id,tenant_id,site_id,name,retired) VALUES(?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name,retired=excluded.retired,revision=revision+1`).bind(input.id, snapshot.policy.tenant, input.site, value.name, Number(input.retired)),
        this.db.prepare('DELETE FROM vc_publishing_group_members WHERE group_id=?').bind(input.id),
        ...members.map(id => this.db.prepare('INSERT INTO vc_publishing_group_members(group_id,user_id) VALUES(?,?)').bind(input.id, id)),
        this.db.prepare(`INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,after_value,operation_key,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), snapshot.policy.tenant, input.site, this.actor,
            input.retired ? 'publishing-group.retire' : 'publishing-group.save', 'publishing-group', input.id, JSON.stringify({ name: value.name, members, retired: input.retired }), input.key, new Date().toISOString()),
      ],
      result: { id: input.id },
    })
  }
}
