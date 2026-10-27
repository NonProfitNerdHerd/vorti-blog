import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { getPlatformProxy } from 'wrangler'
import { acquireRelease, advanceRelease, releaseOperationsSchema, type ReleaseLease, type ReleasePhase } from './lib/release-lock'
import { freezeDatabase, thawDatabase } from './lib/freeze-database'
import { captureExternalEffects } from './lib/capture-external-effects'

// This command authenticates through Wrangler's operational credentials. It never
// exposes an account-recovery or maintenance endpoint to application members.
const options: Record<string, string> = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1]
  if (!['--config', '--action', '--lease', '--baseline', '--evidence', '--phase', '--mode', '--expected-worker', '--provider', '--reference-hash'].includes(key) || !value || options[key]) throw Error('Invalid release operation arguments.')
  options[key] = value
}
const pinned = readFileSync('.node-version', 'utf8').trim().replace(/^v/, '')
if (process.versions.node !== pinned) throw Error(`Use Node ${pinned}.`)
const configPath = path.resolve(options['--config'] || '')
const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'))
if (parsed.error || parsed.config.name !== options['--expected-worker']) throw Error('Operational target identity mismatch.')
const config = parsed.config as {name: string; d1_databases?: Array<{binding: string; database_id: string}>}
const application = config.d1_databases?.find(item => item.binding === 'D1')
const operations = config.d1_databases?.find(item => item.binding === 'OPERATIONS')
if (!application || !operations || application.database_id === operations.database_id) throw Error('Separate operational and application databases are required.')
const proxy = await getPlatformProxy<{D1: D1Database; OPERATIONS: D1Database}>({configPath, remoteBindings: true, persist: false})
const leasePath = path.resolve(options['--lease'] || '')
try {
  for (const statement of releaseOperationsSchema) await proxy.env.OPERATIONS.prepare(statement).run()
  let lease: ReleaseLease
  if (options['--action'] === 'acquire') {
    const baseline = JSON.parse(readFileSync(options['--baseline'], 'utf8'))
    if (baseline.worker !== config.name) throw Error('Recovery baseline targets another Worker.')
    const mode = options['--mode']
    if (!['install', 'upgrade', 'development-reset'].includes(mode)) throw Error('Choose a release mode.')
    lease = await acquireRelease(proxy.env.OPERATIONS, {id: crypto.randomUUID(), target: config.name, mode: mode as 'install' | 'upgrade' | 'development-reset', baseline})
    writeFileSync(leasePath, JSON.stringify(lease, null, 2) + '\n', {flag: 'wx'})
  } else {
    lease = JSON.parse(readFileSync(leasePath, 'utf8')) as ReleaseLease
    if (lease.target !== config.name) throw Error('Release lease targets another Worker.')
    const actual = await proxy.env.OPERATIONS.prepare('SELECT id,target,phase,revision,baseline FROM release_runs WHERE id=? AND target=?').bind(lease.id, lease.target).first<ReleaseLease & {baseline: string}>()
    if (!actual || actual.phase !== lease.phase || actual.revision !== lease.revision) throw Error('Stale release lease; inspect operational state before continuing.')
    if (options['--action'] === 'advance') {
      const evidence = JSON.parse(readFileSync(options['--evidence'], 'utf8')) as Record<string, unknown>
      lease = await advanceRelease(proxy.env.OPERATIONS, lease, options['--phase'] as ReleasePhase, evidence)
      writeFileSync(leasePath, JSON.stringify(lease, null, 2) + '\n')
    } else if (options['--action'] === 'freeze' || options['--action'] === 'thaw') {
      const baseline = JSON.parse(actual.baseline)
      if (!baseline.resources.some((item: {binding: string; id?: string}) => item.binding === 'D1' && item.id === application.database_id)) throw Error('Write guards must target the retained recovery database.')
      if (options['--action'] === 'freeze') {
        if (lease.phase !== 'frozen') throw Error('Activate maintenance before freezing the application.')
        const frozen = await freezeDatabase(proxy.env.D1, lease.id)
        const effects = await captureExternalEffects(proxy.env.D1, proxy.env.OPERATIONS, lease.id)
        console.log(JSON.stringify({...frozen, ...effects}))
      } else {
        if (lease.phase !== 'recovering') throw Error('Only recovery can thaw the prior application database.')
        console.log(JSON.stringify(await thawDatabase(proxy.env.D1, lease.id)))
      }
    } else if (options['--action'] === 'reconcile') {
      const provider = options['--provider'], reference = options['--reference-hash']
      if (!['stripe-test', 'email'].includes(provider) || !/^[a-f0-9]{64}$/.test(reference)) throw Error('Select an exact hashed external effect.')
      const evidence = JSON.parse(readFileSync(options['--evidence'], 'utf8'))
      if (evidence.providerVerified !== true || !['completed', 'not-completed', 'cancelled'].includes(evidence.outcome) || !/^[a-f0-9]{64}$/.test(evidence.evidenceHash || '')) throw Error('Provider-verified outcome and evidence digest are required. Uncertain effects remain blocked.')
      // Resolving records never resends a message, invokes a payment, or creates a job.
      const guard = crypto.randomUUID()
      await proxy.env.OPERATIONS.batch([
        proxy.env.OPERATIONS.prepare("UPDATE release_external_effects SET state='reconciled' WHERE provider=? AND reference_hash=? AND release_id=? AND state='blocked'").bind(provider, reference, lease.id),
        proxy.env.OPERATIONS.prepare('INSERT INTO release_write_guards(id,affected) VALUES(?,changes())').bind(guard),
        proxy.env.OPERATIONS.prepare('INSERT INTO release_external_reconciliations(id,release_id,provider,reference_hash,outcome,evidence_hash,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), lease.id, provider, reference, evidence.outcome, evidence.evidenceHash, new Date().toISOString()),
        proxy.env.OPERATIONS.prepare('DELETE FROM release_write_guards WHERE id=?').bind(guard),
      ])
    } else throw Error('Unknown release operation.')
  }
  console.log(JSON.stringify({run: lease.id, phase: lease.phase, revision: lease.revision}))
} catch {
  throw Error('Operational command failed; maintenance and recovery evidence are retained. Inspect the lease and non-sensitive operational state before retrying.')
} finally { await proxy.dispose() }
