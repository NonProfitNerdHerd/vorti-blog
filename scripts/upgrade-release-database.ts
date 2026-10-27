import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { getPlatformProxy } from 'wrangler'
import { verifyArtifact } from './lib/release-artifact.mjs'
import { migrateDatabase } from './lib/migrate-database'
import { migrations } from '../src/migrations'
import { freezeDatabase, thawDatabase } from './lib/freeze-database'
import { assertUpgradeState } from './lib/upgrade-state'
import type { ReleaseLease } from './lib/release-lock'

const options: Record<string, string> = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1]
  if (!['--config', '--lease', '--manifest', '--artifact', '--validation', '--browser-report', '--recovery', '--action', '--expected-worker', '--receipt', '--deployment'].includes(key) || !value || options[key]) throw Error('Invalid protected upgrade arguments.')
  options[key] = value
}
if (process.versions.node !== readFileSync('.node-version', 'utf8').trim().replace(/^v/, '')) throw Error('Use the pinned runtime.')
execFileSync(process.execPath, ['scripts/require-production-intent.mjs', 'migration'], { stdio: 'inherit' })
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const configPath = path.resolve(options['--config']), parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'))
if (parsed.error || parsed.config.name !== options['--expected-worker']) throw Error('Upgrade target mismatch.')
const config = parsed.config as { name: string; d1_databases: Array<{ binding: string; database_id: string }> }
const application = config.d1_databases.find(item => item.binding === 'D1'), operations = config.d1_databases.find(item => item.binding === 'OPERATIONS')
if (!application || !operations) throw Error('Separate application and operational bindings are required.')
const lease = json(options['--lease']) as ReleaseLease, manifest = json(options['--manifest']), validation = json(options['--validation']), browser = json(options['--browser-report'])
if (validation.status !== 'passed' || validation.source !== manifest.sourceCommit || validation.archiveHash !== manifest.sourceHash ||
    !['typescript', 'lint', 'design-editor', 'integration'].every(stage => validation.records.some((record: { stage: string; exitCode: number }) => record.stage === stage && record.exitCode === 0)) ||
    browser.config?.metadata?.artifactHash !== manifest.artifactHash || browser.config?.metadata?.sourceCommit !== manifest.sourceCommit ||
    !browser.stats?.expected || browser.stats.unexpected || browser.stats.skipped || browser.errors?.length) throw Error('Complete matching source, package and browser validation is required.')
verifyArtifact(path.resolve(options['--artifact']), manifest, manifest)
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== manifest.sourceCommit || git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0] !== manifest.sourceCommit) throw Error('Commit and push the exact validated upgrade source first.')
const migrationHash = createHash('sha256').update(readdirSync('src/migrations').filter(file => file.endsWith('.ts')).sort().map(file => file + '\0' + readFileSync(`src/migrations/${file}`, 'utf8').replaceAll('\r\n', '\n')).join('\0')).digest('hex')
if (migrationHash !== manifest.migrationHash) throw Error('Registered migration source changed after packaging.')
const recovery = json(options['--recovery'])
if (recovery.status !== 'passed' || recovery.databaseID !== application.database_id || recovery.restoredIntegrity !== 'ok' ||
    recovery.foreignKeyViolations !== 0 || recovery.writesStopped !== true || recovery.queuesStopped !== true || recovery.inFlightDrained !== true ||
    !Number.isFinite(Date.parse(recovery.capturedAt)) || Date.now() - Date.parse(recovery.capturedAt) > 15 * 60_000 ||
    hash(recovery.sqlFile) !== recovery.sqlHash || hash(recovery.restoredFile) !== recovery.restoredHash) throw Error('A fresh stopped-write, restored and integrity-verified recovery export is required.')
const action = options['--action']
if (action !== 'migrate' && action !== 'verification-thaw') throw Error('Choose migrate or verification-thaw.')
const active = () => JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deployments', 'list', '--config', configPath, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).sort((a: { created_on: string }, b: { created_on: string }) => Date.parse(b.created_on) - Date.parse(a.created_on))[0]
const deployment = action === 'verification-thaw' ? json(options['--deployment']) : null
const before = active()
if (before.versions.length !== 1 || before.versions[0].percentage !== 100 ||
    (deployment && (deployment.source !== manifest.sourceCommit || deployment.artifactHash !== manifest.artifactHash || before.id !== deployment.deployment || before.versions[0].version_id !== deployment.workerVersion))) throw Error('Deployment identity changed; retain maintenance and reconcile.')
const proxy = await getPlatformProxy<{ D1: D1Database; OPERATIONS: D1Database }>({ configPath, remoteBindings: true, persist: false })
try {
  const actual = await proxy.env.OPERATIONS.prepare('SELECT id,target,mode,phase,revision,baseline FROM release_runs WHERE id=? AND target=?').bind(lease.id, config.name).first<{ id: string; target: string; mode: string; phase: string; revision: number; baseline: string }>()
  const baseline = actual ? JSON.parse(actual.baseline) : null
  assertUpgradeState({ lease, actual, action, applicationID: application.database_id, operationsID: operations.database_id,
    baselineApplicationID: baseline?.resources.find((item: { binding: string; id: string }) => item.binding === 'D1')?.id,
    recoveryVerified: true, artifactVerified: true })
  if (action === 'migrate' && before.id !== baseline.deployment) throw Error('Production advanced before migration. Reconcile first.')
  let result: Record<string, unknown>
  if (action === 'migrate') {
    const prefix = `vc_release_freeze_${lease.id.replaceAll('-', '_')}_`
    const frozen = await proxy.env.D1.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND substr(name,1,?)=?").bind(prefix.length, prefix).first<{ n: number }>()
    if (!frozen?.n) throw Error('Stop and drain application writes before migrating.')
    await thawDatabase(proxy.env.D1, lease.id)
    try { result = await migrateDatabase(proxy.env.D1) }
    finally { await freezeDatabase(proxy.env.D1, lease.id) }
  } else {
    const ledger = (await proxy.env.D1.prepare('SELECT name FROM payload_migrations ORDER BY id').all<{ name: string }>()).results.map(row => row.name)
    if (JSON.stringify(ledger) !== JSON.stringify(migrations.map(item => item.name)) || (await proxy.env.D1.prepare('PRAGMA foreign_key_check').all()).results.length) throw Error('The live migration chain or integrity changed before verification.')
    result = await thawDatabase(proxy.env.D1, lease.id)
  }
  writeFileSync(options['--receipt'], JSON.stringify({ status: 'passed', action, run: lease.id, source: manifest.sourceCommit, artifactHash: manifest.artifactHash, databaseID: application.database_id, ...result, checkedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ status: 'passed', action, run: lease.id }))
} finally { await proxy.dispose() }
