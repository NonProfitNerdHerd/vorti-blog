import { readFileSync } from 'node:fs'
import { pbkdf2Sync, randomBytes, createHash } from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'
import { getPlatformProxy } from 'wrangler'

// Operational recovery is authenticated by Cloudflare credentials, never by a
// tenant role. The new password is accepted only through the process environment.
const args: Record<string, string> = {}
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--config', '--expected-worker', '--email', '--case'].includes(process.argv[i]) || !process.argv[i + 1] || args[process.argv[i]]) throw Error('Provide --config, --expected-worker, --email and --case.')
  args[process.argv[i]] = process.argv[i + 1]
}
if (process.versions.node !== readFileSync('.node-version', 'utf8').trim().replace(/^v/, '')) throw Error('Use the pinned Node runtime.')
const email = args['--email']?.trim().toLowerCase(), reason = args['--case']
const password = process.env.VORTI_RECOVERY_PASSWORD
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[a-zA-Z0-9_-]{8,80}$/.test(reason || '') || !password || password.length < 12 || password.length > 128) throw Error('A valid email, non-sensitive case identifier, and VORTI_RECOVERY_PASSWORD of 12–128 characters are required.')
const configPath = path.resolve(args['--config'] || '')
const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'))
if (parsed.error || parsed.config.name !== args['--expected-worker']) throw Error('Recovery target mismatch.')
const application = parsed.config.d1_databases?.find((item: {binding: string}) => item.binding === 'D1')
const operations = parsed.config.d1_databases?.find((item: {binding: string}) => item.binding === 'OPERATIONS')
if (!application || !operations || application.database_id === operations.database_id) throw Error('Recovery requires separate operational storage.')
const proxy = await getPlatformProxy<{D1: D1Database; OPERATIONS: D1Database}>({configPath, remoteBindings: true, persist: false})
const id = crypto.randomUUID(), digest = createHash('sha256').update(email).digest('hex')
try {
  const db = proxy.env.D1, audit = proxy.env.OPERATIONS
  await audit.prepare('CREATE TABLE IF NOT EXISTS account_recovery_events(id TEXT NOT NULL,stage TEXT NOT NULL,account_hash TEXT NOT NULL,case_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(id,stage))').run()
  for (const operation of ['UPDATE', 'DELETE']) await audit.prepare(`CREATE TRIGGER IF NOT EXISTS account_recovery_immutable_${operation.toLowerCase()} BEFORE ${operation} ON account_recovery_events BEGIN SELECT RAISE(ABORT,'Recovery evidence is append-only'); END`).run()
  const accounts = (await db.prepare('SELECT id FROM users WHERE lower(trim(email))=?').bind(email).all<{id: number}>()).results
  if (accounts.length !== 1) throw Error('An exact account is required.')
  const actor = accounts[0].id
  await audit.prepare("INSERT INTO account_recovery_events VALUES(?,'requested',?,?,?)").bind(id, digest, reason, new Date().toISOString()).run()
  const salt = randomBytes(32).toString('hex'), hash = pbkdf2Sync(password, salt, 25000, 512, 'sha256').toString('hex')
  const guard = crypto.randomUUID()
  await db.batch([
    db.prepare('UPDATE users SET salt=?,hash=?,login_attempts=0,lock_until=NULL,reset_password_token=NULL,reset_password_expiration=NULL,updated_at=? WHERE id=? AND lower(trim(email))=?').bind(salt, hash, new Date().toISOString(), actor, email),
    db.prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())').bind(guard),
    db.prepare('DELETE FROM users_sessions WHERE _parent_id=?').bind(actor),
    db.prepare('UPDATE vc_account_status SET disabled=0 WHERE user_id=?').bind(actor),
    db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
  ])
  await audit.prepare("INSERT INTO account_recovery_events VALUES(?,'completed',?,?,?)").bind(id, digest, reason, new Date().toISOString()).run()
  console.log(JSON.stringify({recovery: id, completed: true, sessionsRevoked: true, tenantMembershipsUnchanged: true}))
} catch {
  throw Error(`Recovery ${id} did not finish all checks. Inspect its operational audit before retrying. No password or credential material is logged.`)
} finally { await proxy.dispose() }
