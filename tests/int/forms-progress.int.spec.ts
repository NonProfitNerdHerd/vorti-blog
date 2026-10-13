import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { transferProgress } from '@/forms/progress'
import { openMessage, sealMessage } from '@/forms/private-message'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE form_drafts(id INTEGER PRIMARY KEY,site TEXT,revision TEXT,session_hash TEXT,token_hash TEXT,updated_at TEXT,expires_at TEXT,revoked_at TEXT);
    CREATE TABLE form_attachments(id TEXT PRIMARY KEY,site TEXT,revision TEXT,session_hash TEXT,submission_i_d TEXT,expires_at TEXT,scan_status TEXT);
    INSERT INTO form_drafts VALUES(1,'default','v1','old','hashed-token','2026-01-01','2027-01-01',NULL);
    INSERT INTO form_attachments VALUES('file','default','v1','old',NULL,'2027-01-01','unscanned');`)
  const db = { prepare(sql: string) {
    let values: (string | number)[] = []
    const statement = { bind(...next: (string | number)[]) { values = next; return statement }, async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } } } }
    return statement
  }, async batch(statements: { run: () => Promise<unknown> }[]) {
    sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results } catch (error) { sqlite.exec('ROLLBACK'); throw error }
  } } as unknown as D1Database
  const input = { id: 1, site: 'default', revision: 'v1', previousSession: 'old', session: 'new', updatedAt: '2026-01-01', expiresAt: '2027-01-01', tokenHash: 'rotated-hash', files: ['file'] }
  return { sqlite, db, input }
}
describe('Saved progress transfer', () => {
  it('encrypts private messages with unique nonces and binds them to the site and job', async () => {
    const text = 'https://example.test/forms/apply#resume=private-token'
    const one = await sealMessage('test-secret', 'site:job', text), two = await sealMessage('test-secret', 'site:job', text)
    expect(one).not.toBe(two)
    expect(one).not.toContain('private-token')
    expect(await openMessage('test-secret', 'site:job', one)).toBe(text)
    await expect(openMessage('test-secret', 'other-site:job', one)).rejects.toThrow()
    await expect(openMessage('wrong-secret', 'site:job', one)).rejects.toThrow()
    await expect(openMessage('test-secret', 'site:job', one.slice(0, -5) + 'AAAAA')).rejects.toThrow()
  })
  it('transfers the snapshot and owned files together and refuses a competing stale resume', async () => {
    const { sqlite, db, input } = fixture()
    await transferProgress(db, input, '2026-02-01')
    expect(sqlite.prepare('SELECT session_hash,token_hash FROM form_drafts').get()).toMatchObject({ session_hash: 'new', token_hash: 'rotated-hash' })
    expect(sqlite.prepare('SELECT session_hash FROM form_attachments').get()).toMatchObject({ session_hash: 'new' })
    await expect(transferProgress(db, { ...input, session: 'competing' }, '2026-02-01')).rejects.toThrow('changed in another session')
    expect(sqlite.prepare('SELECT session_hash FROM form_attachments').get()).toMatchObject({ session_hash: 'new' })
  })
  it.each(['expired', 'submitted', 'wrong-session', 'revoked', 'changed', 'wrong-site'])('keeps all ownership unchanged when %s', async reason => {
    const { sqlite, db, input } = fixture()
    if (reason === 'expired') sqlite.exec("UPDATE form_attachments SET expires_at='2025-01-01'")
    if (reason === 'submitted') sqlite.exec("UPDATE form_attachments SET submission_i_d='entry'")
    if (reason === 'wrong-session') sqlite.exec("UPDATE form_attachments SET session_hash='other'")
    if (reason === 'revoked') sqlite.exec("UPDATE form_drafts SET revoked_at='2026-01-02'")
    if (reason === 'changed') sqlite.exec("UPDATE form_drafts SET updated_at='2026-01-02'")
    if (reason === 'wrong-site') input.site = 'other'
    await expect(transferProgress(db, input, '2026-02-01')).rejects.toThrow()
    expect(sqlite.prepare('SELECT session_hash FROM form_drafts').get()).toMatchObject({ session_hash: 'old' })
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM form_attachments WHERE session_hash='new'").get()).toMatchObject({ count: 0 })
  })
})
