import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { getPlatformProxy } from 'wrangler'

const remote = process.argv.includes('--remote')
if (remote && !process.argv.includes('--confirm-read-only-remote')) throw new Error('Remote preflight requires --remote --confirm-read-only-remote.')
if (!remote && !process.env.DESIGN_CORE_TEST_PERSIST_PATH) throw new Error('Local preflight requires DESIGN_CORE_TEST_PERSIST_PATH to identify the isolated D1 state.')
const adminEmail = process.env.DESIGN_ADMIN_EMAIL?.trim().toLowerCase()
const migrationNames = [
  '20260917_163401_design_system_stage1',
  '20260917_165910_design_system_stage2',
  '20260918_135802_design_system_stage3',
]
const environment = process.env.CLOUDFLARE_ENV || undefined
const proxy = remote ? null : await getPlatformProxy({ remoteBindings: false, environment, persist: { path: process.env.DESIGN_CORE_TEST_PERSIST_PATH } })
try {
  const query = async (statement, params = []) => {
    if (!/^\s*(SELECT|PRAGMA table_info\()/i.test(statement)) throw new Error('Preflight accepts read-only SQL only')
    if (proxy) return (await proxy.env.D1.prepare(statement).bind(...params).all()).results
    const sql = statement.replaceAll('?', () => {
      const value = params.shift()
      if (typeof value !== 'string') throw new Error('Unsupported preflight SQL parameter')
      return `'${value.replaceAll("'", "''")}'`
    })
    const args = [resolve('node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'D1', '--remote', '--json', '--command', sql]
    if (environment) args.push('--env', environment)
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`Read-only remote D1 query failed: ${result.stderr || result.stdout}`)
    return JSON.parse(result.stdout).flatMap((entry) => entry.results ?? [])
  }
  const tables = new Set((await query("SELECT name FROM sqlite_master WHERE type = 'table';")).map((row) => row.name))
  const count = async (table) => tables.has(table) ? Number((await query(`SELECT count(*) AS count FROM ${table};`))[0]?.count ?? 0) : null
  const users = await count('users')
  const emailValid = Boolean(adminEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))
  const matchingUsers = emailValid && tables.has('users') ? Number((await query('SELECT count(*) AS count FROM users WHERE lower(email) = ?;', [adminEmail]))[0]?.count ?? 0) : null
  const applied = tables.has('payload_migrations') ? new Set((await query('SELECT name FROM payload_migrations;')).map((row) => row.name)) : new Set()
  const migrations = migrationNames.map((name) => {
    const source = readFileSync(resolve(`src/migrations/${name}.ts`), 'utf8')
    const up = source.split('export async function up')[1]?.split('export async function down')[0] ?? ''
    return { name, applied: applied.has(name), applicable: !applied.has(name), destructiveUp: /\b(DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE)\b/i.test(up), expectedChanges: name.includes('stage1') ? 'Design Type, Design, and Template tables' : name.includes('stage2') ? 'User role, Hero fields and seed records' : 'Post Template fields and Template section Block Type links' }
  })
  const report = {
    target: remote ? 'production-remote-read-only' : 'local-read-only',
    binding: { config: 'wrangler.jsonc', environment: environment ?? 'root', localPersistencePath: remote ? undefined : process.env.DESIGN_CORE_TEST_PERSIST_PATH },
    environment: { designAdminEmailConfigured: emailValid, payloadSecretPresent: Boolean(process.env.PAYLOAD_SECRET), cloudflareTokenEnvironmentPresent: Boolean(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY) },
    schema: { usersTable: tables.has('users'), userRoleColumn: tables.has('users') && (await query('PRAGMA table_info(users);')).some((column) => column.name === 'role'), postsTable: tables.has('posts'), postTemplateValuesColumn: tables.has('posts') && (await query('PRAGMA table_info(posts);')).some((column) => column.name === 'template_values'), pagesTable: tables.has('pages'), designTablesPresent: tables.has('design_block_types') && tables.has('design_templates'), migrationTablePresent: tables.has('payload_migrations') },
    counts: { users, posts: await count('posts'), pages: await count('pages'), matchingAdministratorUsers: matchingUsers },
    administratorReady: remote ? (emailValid && matchingUsers === 1) : (users === 0 || (emailValid && matchingUsers === 1)),
    migrations,
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.administratorReady) process.exitCode = 2
} finally {
  await proxy?.dispose()
}
