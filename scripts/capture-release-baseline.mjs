import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Read-only production inspection. This command never migrates, seeds, or deploys.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const options = {}
for (let index = 0; index < args.length; index += 2) {
  const key = args[index]
  if (
    !['--output', '--admin-email', '--expected-worker', '--expected-baseline'].includes(key) ||
    !args[index + 1] ||
    options[key]
  )
    throw Error('Use --output <file> --admin-email <email> --expected-worker <name>.')
  options[key] = args[index + 1]
}
const email = options['--admin-email']?.trim().toLowerCase()
if (!email || !/^[^\s@'";]+@[^\s@'";]+\.[^\s@'";]+$/.test(email))
  throw Error('A valid administrator email is required.')
if (!options['--output'] || !options['--expected-worker'])
  throw Error('An output file and expected Worker name are required.')
const pinnedNode = readFileSync(path.join(root, '.node-version'), 'utf8').trim().replace(/^v/, '')
if (process.versions.node !== pinnedNode) throw Error(`Use the pinned Node runtime ${pinnedNode}.`)
const run = (command, parameters) =>
  execFileSync(command, parameters, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
const wrangler = (...parameters) =>
  JSON.parse(
    run(process.execPath, [
      path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
      ...parameters,
      '--json',
    ]),
  )
const configSource = readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8')
const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', configSource)
if (parsed.error) throw Error('Invalid production configuration.')
const config = parsed.config
if (config.name !== options['--expected-worker']) throw Error('Worker target identity mismatch.')
const expected = options['--expected-baseline']
  ? JSON.parse(readFileSync(path.resolve(root, options['--expected-baseline']), 'utf8'))
  : null
if (expected && expected.worker !== config.name)
  throw Error('Expected baseline targets another Worker.')
// During preparation the source configuration may describe replacement resources.
// An explicit retained snapshot identifies the still-active recovery resources.
const expectedConfig = expected
  ? {
      d1_databases: expected.resources
        .filter((item) => item.type === 'd1')
        .map((item) => ({ binding: item.binding, database_id: item.id, database_name: item.name })),
      r2_buckets: expected.resources
        .filter((item) => item.type === 'r2_bucket')
        .map((item) => ({ binding: item.binding, bucket_name: item.name })),
      queues: {
        producers: expected.resources
          .filter((item) => item.type === 'queue')
          .map((item) => ({ binding: item.binding, queue: item.name })),
      },
    }
  : config
const source = run('git', ['rev-parse', 'HEAD'])
const remote = run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0]
if (source !== remote)
  throw Error(
    'Local source differs from remote main; reconcile before recording a release baseline.',
  )
const dirty = run('git', ['status', '--porcelain']).length > 0
const deployments = wrangler('deployments', 'list')
const active = deployments.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0]
if (!active || active.versions.length !== 1 || active.versions[0].percentage !== 100)
  throw Error('A single active 100% deployment is required; reconcile split traffic first.')
const version = wrangler('versions', 'view', active.versions[0].version_id)
if (
  version.id !== active.versions[0].version_id ||
  (expected && (expected.deployment !== active.id || expected.version !== version.id))
)
  throw Error('Active deployment no longer matches the retained baseline.')
const bindings = version.resources.bindings
const resources = []
for (const item of expectedConfig.d1_databases || []) {
  const binding = bindings.find((value) => value.name === item.binding && value.type === 'd1')
  if ((binding?.database_id || binding?.id) !== item.database_id)
    throw Error(`Database binding mismatch: ${item.binding}.`)
  resources.push({
    binding: item.binding,
    type: 'd1',
    id: item.database_id,
    name: item.database_name,
  })
}
for (const item of expectedConfig.r2_buckets || []) {
  const binding = bindings.find(
    (value) => value.name === item.binding && value.type === 'r2_bucket',
  )
  if (binding?.bucket_name !== item.bucket_name)
    throw Error(`Storage binding mismatch: ${item.binding}.`)
  resources.push({ binding: item.binding, type: 'r2_bucket', name: item.bucket_name })
}
for (const item of expectedConfig.queues?.producers || []) {
  const binding = bindings.find((value) => value.name === item.binding && value.type === 'queue')
  if (binding?.queue_name !== item.queue) throw Error(`Queue binding mismatch: ${item.binding}.`)
  resources.push({ binding: item.binding, type: 'queue', name: item.queue })
}
if (!resources.some((item) => item.binding === 'D1' && item.type === 'd1'))
  throw Error('Missing application database binding.')
if (
  bindings.some(
    (binding) =>
      ['d1', 'r2_bucket', 'queue'].includes(binding.type) &&
      !resources.some(
        (resource) => resource.binding === binding.name && resource.type === binding.type,
      ),
  )
)
  throw Error('Production has resource bindings absent from the source configuration.')
const sql = [
  'SELECT name,batch FROM payload_migrations ORDER BY id',
  'PRAGMA foreign_key_check',
  `SELECT count(*) AS matching_active_accounts FROM users u WHERE lower(trim(u.email))='${email}' AND NOT EXISTS(SELECT 1 FROM vc_account_status s WHERE s.user_id=u.id AND s.disabled=1)`,
].join(';')
const database = resources.find((item) => item.binding === 'D1').id
const queries = wrangler('d1', 'execute', database, '--remote', '--command', sql)
if (queries.length !== 3 || queries.some((query) => !query.success))
  throw Error('Database preflight failed.')
if (queries.some((query) => query.meta?.rows_written !== 0))
  throw Error('Read-only inspection unexpectedly reported writes.')
if (queries[1].results.length) throw Error('Live foreign-key violations require investigation.')
if (queries[2].results[0]?.matching_active_accounts !== 1)
  throw Error('Expected exactly one active administrator login identity.')
const ledger = queries[0].results
if (!ledger.length || new Set(ledger.map((row) => row.name)).size !== ledger.length)
  throw Error('Invalid migration ledger.')
const registered = [
  ...readFileSync(path.join(root, 'src/migrations/index.ts'), 'utf8').matchAll(
    /name:\s*['"]([^'"]+)['"]/g,
  ),
].map((match) => match[1])
if (ledger.some((row, index) => registered[index] !== row.name))
  throw Error(
    'The live migration ledger is not an ordered prefix of the registered source migrations.',
  )
// Re-read after inspecting D1; a release racing this inspection invalidates the snapshot.
const after = wrangler('deployments', 'list').sort(
  (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on),
)[0]
const ledgerAfter = wrangler(
  'd1',
  'execute',
  database,
  '--remote',
  '--command',
  'SELECT name,batch FROM payload_migrations ORDER BY id',
)
if (
  after?.id !== active.id ||
  JSON.stringify(ledgerAfter[0]?.results) !== JSON.stringify(ledger) ||
  run('git', ['rev-parse', 'HEAD']) !== source ||
  readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8') !== configSource ||
  run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] !== remote
)
  throw Error(
    'Production or source advanced during inspection. Repeat preflight against the new baseline.',
  )
const hash = (value) => createHash('sha256').update(value).digest('hex')
const receipt = {
  capturedAt: new Date().toISOString(),
  worker: config.name,
  source,
  remoteMain: remote,
  dirty,
  deployment: active.id,
  version: version.id,
  deployedAt: active.created_on,
  resources,
  secretNames: bindings
    .filter((binding) => binding.type === 'secret_text')
    .map((binding) => binding.name)
    .sort(),
  configurationHash: hash(JSON.stringify({ bindings, runtime: version.resources.script_runtime })),
  sourceConfigurationHash: hash(configSource),
  migrationLedgerHash: hash(JSON.stringify(ledger)),
  migrationLedger: ledger,
  foreignKeyViolations: 0,
  matchingActiveAdministratorIdentities: 1,
}
const output = path.resolve(root, options['--output'])
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
console.log(
  JSON.stringify({
    output,
    source,
    deployment: active.id,
    version: version.id,
    migrations: ledger.length,
    dirty,
  }),
)
