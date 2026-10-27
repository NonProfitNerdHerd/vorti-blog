import { TenantRepository, TenantPermissionError } from './tenant-repository'
import { canDelegate } from './tenant-policy'
import { atomicSiteMutation } from './atomic'

export const invitationSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_tenant_invitations(
  id TEXT PRIMARY KEY NOT NULL,tenant_id TEXT NOT NULL REFERENCES vc_organizations(id),site_id TEXT NOT NULL REFERENCES vc_sites(id),
  email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,issuer_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,consumed_at TEXT,user_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL
)`,
]
type Invitation = {
  id: string
  tenant_id: string
  site_id: string
  email: string
  issuer_id: number
  expires_at: string
}
const hash = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
export class InvitationRepository {
  constructor(private db: D1Database) {}
  private async administrator(actor: number, site: string) {
    const repo = new TenantRepository(this.db, actor),
      snapshot = await repo.snapshot(site)
    if (
      !canDelegate(snapshot.policy, {
        site: null,
        descendants: true,
        permissions: ['administration:tenant-administrators'],
      })
    )
      throw new TenantPermissionError()
    return { tenant: snapshot.policy.tenant, revision: snapshot.revision }
  }
  async issue(actor: number, site: string, email: string, operationKey: string) {
    const normalized = email.trim().toLowerCase()
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
      throw Error('Enter a valid invitation email.')
    const authority = await this.administrator(actor, site),
      id = crypto.randomUUID()
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    const now = new Date().toISOString(),
      expires = new Date(Date.now() + 7 * 86400000).toISOString(),
      guard = `${operationKey}:invitation`
    await atomicSiteMutation(this.db, {
      actor,
      operationKey,
      fingerprint: await hash(JSON.stringify({ id, site, email: normalized })),
      write: this.db
        .prepare(
          'INSERT INTO vc_tenant_invitations(id,tenant_id,site_id,email,token_hash,issuer_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(id, authority.tenant, site, normalized, await hash(token), actor, expires, now),
      afterWrite: [
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,COUNT(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
          )
          .bind(guard, authority.tenant, authority.revision),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
        this.db
          .prepare(
            'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            authority.tenant,
            site,
            actor,
            'tenant.invited',
            'invitation',
            id,
            operationKey,
            now,
          ),
      ],
      result: { id, expiresAt: expires },
    })
    // The bearer token is returned once, never persisted in audits or operation receipts.
    return { id, token, expiresAt: expires }
  }
  async inspect(token: string): Promise<Invitation> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new TenantPermissionError()
    const invitation = await this.db
      .prepare(
        'SELECT id,tenant_id,site_id,email,issuer_id,expires_at FROM vc_tenant_invitations WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?',
      )
      .bind(await hash(token), new Date().toISOString())
      .first<Invitation>()
    if (!invitation) throw new TenantPermissionError()
    await this.administrator(invitation.issuer_id, invitation.site_id)
    return invitation
  }
  async accept(token: string, user: number) {
    const invitation = await this.inspect(token),
      authority = await this.administrator(invitation.issuer_id, invitation.site_id)
    const account = await this.db
      .prepare(
        'SELECT id FROM users WHERE id=? AND lower(trim(email))=? AND NOT EXISTS(SELECT 1 FROM vc_account_status WHERE user_id=users.id AND disabled=1)',
      )
      .bind(user, invitation.email)
      .first()
    if (!account) throw new TenantPermissionError()
    const operationKey = crypto.randomUUID(),
      guard = `${operationKey}:invitation`,
      now = new Date().toISOString()
    return atomicSiteMutation(this.db, {
      actor: user,
      operationKey,
      fingerprint: await hash(`${invitation.id}:${user}`),
      write: this.db
        .prepare(
          'UPDATE vc_tenant_invitations SET consumed_at=?,user_id=? WHERE id=? AND consumed_at IS NULL AND expires_at>?',
        )
        .bind(now, user, invitation.id, now),
      afterWrite: [
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,COUNT(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
          )
          .bind(guard, authority.tenant, authority.revision),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
        this.db
          .prepare(
            'INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES(?,?,1) ON CONFLICT(tenant_id,user_id) DO NOTHING',
          )
          .bind(authority.tenant, user),
        this.db
          .prepare(
            'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            authority.tenant,
            invitation.site_id,
            user,
            'tenant.invitation-accepted',
            'invitation',
            invitation.id,
            operationKey,
            now,
          ),
      ],
      result: { site: invitation.site_id, accepted: true },
    })
  }
}
