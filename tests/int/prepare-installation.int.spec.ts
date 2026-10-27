import { expect, it } from 'vitest'
import { pbkdf2Sync } from 'node:crypto'
import { localD1 } from '../helpers/local-d1'
import { administratorIdentity, prepareInstallation } from '../../scripts/lib/prepare-installation'

it('installs once, preserves populated data on upgrade, and resets only into a fresh database with unchanged credentials', async () => {
  const source = localD1(),
    replacement = localD1()
  try {
    const result = await prepareInstallation(source.db, {
      mode: 'install',
      administratorEmail: 'admin@example.com',
      password: 'synthetic-password-only',
    })
    expect(result).toMatchObject({
      emptyContent: true,
      builtInsVerified: true,
      credentialsVerified: true,
    })
    const identity = await administratorIdentity(source.db, ' ADMIN@example.com ')
    expect(source.sqlite.prepare("SELECT initialized,published FROM vc_site_websites WHERE site_id='default'").get()).toEqual({initialized:1,published:1})
    expect(
      pbkdf2Sync('synthetic-password-only', identity.salt, 25000, 512, 'sha256').toString('hex'),
    ).toBe(identity.hash)
    await expect(
      prepareInstallation(source.db, {
        mode: 'install',
        administratorEmail: 'other@example.com',
        password: 'replacement-password',
      }),
    ).rejects.toThrow('empty replacement')
    source.sqlite.exec(
      "INSERT INTO vc_automations(id,site,owner,name,draft,created_at,updated_at) VALUES('retained','default',1,'Populated upgrade fixture','{}','2026-01-01','2026-01-01')",
    )
    expect(await prepareInstallation(source.db, { mode: 'upgrade' })).toMatchObject({
      dataPreserved: true,
      applied: [],
    })
    expect(source.sqlite.prepare('SELECT name FROM vc_automations').get()?.name).toBe(
      'Populated upgrade fixture',
    )
    await expect(
      prepareInstallation(replacement.db, {
        mode: 'development-reset',
        identity,
        administratorEmail: identity.email,
      }),
    ).rejects.toThrow('Explicit')
    expect(
      await prepareInstallation(replacement.db, {
        mode: 'development-reset',
        discardDevelopmentData: true,
        identity,
        administratorEmail: identity.email,
      }),
    ).toMatchObject({ emptyContent: true, credentialsVerified: true })
    expect(await administratorIdentity(replacement.db, identity.email)).toEqual(identity)
    expect(replacement.sqlite.prepare('SELECT count(*) n FROM vc_automations').get()?.n).toBe(0)
    expect(replacement.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(JSON.stringify(result)).not.toContain(identity.hash)
  } finally {
    source.close()
    replacement.close()
  }
})
