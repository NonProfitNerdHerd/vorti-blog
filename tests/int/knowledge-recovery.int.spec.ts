import { expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { migrateDatabase } from '../../scripts/lib/migrate-database'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { KnowledgeRepository } from '@/knowledge/repository'
import { emptyKnowledgeBody } from '@/knowledge/content'

it('blocks legacy Intranet access after the unified schema appears while retaining Wiki and source history', async () => {
  const f = localD1()
  try {
    await migrateDatabase(f.db)
    f.sqlite.exec("INSERT INTO users(id,email,role) VALUES(1,'recovery@example.invalid','administrator')")
    await bootstrapTenant(f.db, { tenant: 'default', site: 'default', administratorEmail: 'recovery@example.invalid' })
    await activateTenantAuthority(f.db, 'default')
    const repo = new KnowledgeRepository(f.db, 1)
    // On the compatibility schema, legacy publishing remains functional. On a
    // later schema, the same recovery Worker must not read the old broader ACL.
    const installed = f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='vc_publishing_legacy_map'").get()
    if (!installed) {
      await repo.save({ id: 'legacy-private', site: 'default', kind: 'intranet', parent: null, title: 'Legacy source', slug: 'legacy-source',
        body: emptyKnowledgeBody, visibility: 'private', expectedRevision: 0, action: 'save', operationKey: crypto.randomUUID() })
      f.sqlite.exec('CREATE TABLE vc_publishing_legacy_map(legacy_id TEXT PRIMARY KEY,page_id INTEGER)')
    }
    const before = f.sqlite.prepare('SELECT count(*) n FROM vc_knowledge_versions').get()!.n
    await expect(repo.list('default', 'intranet')).rejects.toMatchObject({ status: 409 })
    await expect(repo.get('default', 'intranet', 'legacy-private', true)).rejects.toMatchObject({ status: 409 })
    await expect(repo.save({ id: 'new-legacy', site: 'default', kind: 'intranet', parent: null, title: 'Must not save', slug: 'must-not-save',
      body: emptyKnowledgeBody, visibility: 'private', expectedRevision: 0, action: 'save', operationKey: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 })
    expect((await repo.list('default', 'wiki')).docs).toEqual([])
    expect(f.sqlite.prepare('SELECT count(*) n FROM vc_knowledge_versions').get()!.n).toBe(before)
  } finally { f.close() }
})
