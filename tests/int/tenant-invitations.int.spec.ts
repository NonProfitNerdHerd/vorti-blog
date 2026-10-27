import { expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { migrateDatabase } from '../../scripts/lib/migrate-database'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { InvitationRepository } from '../../src/organizations/invitations'

it('uses expiring single-use invitations without changing shared credentials or granting roles', async () => {
  const f = localD1()
  try {
    await migrateDatabase(f.db)
    f.sqlite.exec(
      "INSERT INTO users(id,email,role,hash) VALUES(1,'admin@example.com','administrator','admin-credential'),(2,'member@example.com','editor','shared-credential'),(3,'other@example.com','editor','other-credential')",
    )
    await bootstrapTenant(f.db, {
      tenant: 'default',
      site: 'default',
      administratorEmail: 'admin@example.com',
    })
    await activateTenantAuthority(f.db, 'default')
    const repo = new InvitationRepository(f.db)
    await expect(
      repo.issue(2, 'default', 'new@example.com', crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 403 })
    const invitation = await repo.issue(1, 'default', 'MEMBER@example.com', crypto.randomUUID())
    expect((await repo.inspect(invitation.token)).email).toBe('member@example.com')
    expect(
      f.sqlite.prepare('SELECT token_hash FROM vc_tenant_invitations').get()?.token_hash,
    ).not.toBe(invitation.token)
    expect(
      f.sqlite
        .prepare('SELECT result FROM vc_platform_operations WHERE result LIKE ?')
        .get(`%${invitation.token}%`),
    ).toBeUndefined()
    await expect(repo.accept(invitation.token, 3)).rejects.toMatchObject({ status: 403 })
    expect(await repo.accept(invitation.token, 2)).toMatchObject({ accepted: true })
    await expect(repo.accept(invitation.token, 2)).rejects.toMatchObject({ status: 403 })
    expect(f.sqlite.prepare('SELECT hash FROM users WHERE id=2').get()?.hash).toBe(
      'shared-credential',
    )
    expect(
      f.sqlite.prepare('SELECT active FROM vc_tenant_memberships WHERE user_id=2').get()?.active,
    ).toBe(1)
    expect(
      f.sqlite.prepare('SELECT count(*) n FROM vc_tenant_assignments WHERE user_id=2').get()?.n,
    ).toBe(0)
    const expired = await repo.issue(1, 'default', 'other@example.com', crypto.randomUUID())
    f.sqlite
      .prepare("UPDATE vc_tenant_invitations SET expires_at='2000-01-01' WHERE id=?")
      .run(expired.id)
    await expect(repo.inspect(expired.token)).rejects.toMatchObject({ status: 403 })
  } finally {
    f.close()
  }
})
