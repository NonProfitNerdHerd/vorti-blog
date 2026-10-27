import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { getPlatformProxy } from 'wrangler'
import { approvedCleanupTargets } from './lib/release-target.mjs'

const args: Record<string, string> = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  if (!['--config', '--baseline', '--verification', '--lease', '--receipt', '--expected-worker', '--discard-development-data'].includes(key) || !value || args[key]) throw Error('Invalid cleanup arguments.')
  args[key] = value
}
if (args['--discard-development-data'] !== 'YES') throw Error('Cleanup requires --discard-development-data YES.')
if (process.versions.node !== readFileSync('.node-version', 'utf8').trim().replace(/^v/, '')) throw Error('Use the pinned Node runtime.')
const configPath = path.resolve(args['--config'])
const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'))
if (parsed.error || parsed.config.name !== args['--expected-worker']) throw Error('Cleanup target mismatch.')
const config = parsed.config as {name: string; compatibility_date: string; d1_databases: {binding: string; database_id: string; database_name: string}[]; r2_buckets: {binding: string; bucket_name: string}[]; queues?: {producers?: {binding: string; queue: string}[]}}
const baseline = JSON.parse(readFileSync(args['--baseline'], 'utf8'))
const verification = JSON.parse(readFileSync(args['--verification'], 'utf8'))
const lease = JSON.parse(readFileSync(args['--lease'], 'utf8'))
const resources = [...config.d1_databases.map(item => ({type: 'd1', binding: item.binding, id: item.database_id, name: item.database_name})), ...config.r2_buckets.map(item => ({type: 'r2_bucket', binding: item.binding, name: item.bucket_name})), ...(config.queues?.producers || []).map(item => ({type: 'queue', binding: item.binding, name: item.queue}))]
const targets = approvedCleanupTargets({mode: 'development-reset', discardDevelopmentData: true, expectedWorker: config.name, baseline, replacement: {worker: config.name, deployment: verification.deployment, version: verification.workerVersion, resources}}, verification) as {type: string; binding: string; id?: string; name: string}[]
const cli = (...parameters: string[]) => execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...parameters], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
const deployments = JSON.parse(cli('deployments', 'list', '--config', configPath, '--json')) as {id: string; created_on: string; versions: {version_id: string; percentage: number}[]}[]
const live = deployments.sort((a,b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0]
if (live.id !== verification.deployment || live.versions.length !== 1 || live.versions[0].version_id !== verification.workerVersion || live.versions[0].percentage !== 100) throw Error('Production changed after verification. Do not delete recovery resources.')
const operations = config.d1_databases.find(item => item.binding === 'OPERATIONS')
if (!operations) throw Error('Operational database is required.')
const directory = path.resolve('.wrangler/release-cleanup', crypto.randomUUID())
mkdirSync(directory, {recursive: true})
const proxyConfig = path.join(directory, 'resources.json')
writeFileSync(proxyConfig, JSON.stringify({name: 'verified-release-cleanup', compatibility_date: config.compatibility_date, d1_databases: [{...operations, remote: true}], r2_buckets: targets.filter(item => item.type === 'r2_bucket').map(item => ({binding: item.binding, bucket_name: item.name, remote: true}))}))
const proxy = await getPlatformProxy<{OPERATIONS: D1Database; R2: R2Bucket; WORKSPACE_FILES: R2Bucket}>({configPath: proxyConfig, remoteBindings: true, persist: false})
const receiptPath = path.resolve(args['--receipt'])
const receipt = {worker: config.name, deployment: live.id, startedAt: new Date().toISOString(), targets, deleted: [] as object[]}
try {
  const run = await proxy.env.OPERATIONS.prepare("SELECT id FROM release_runs WHERE id=? AND target=? AND phase='complete' AND revision=? AND mode='development-reset'").bind(lease.id, config.name, lease.revision).first()
  if (!run) throw Error('The exact development-reset release must be complete before cleanup.')
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'})
  for (const target of targets) {
    if (target.type === 'r2_bucket') {
      const bucket = proxy.env[target.binding as 'R2' | 'WORKSPACE_FILES']
      for (;;) {
        const objects = await bucket.list({limit: 1000})
        if (!objects.objects.length) break
        await bucket.delete(objects.objects.map(item => item.key))
      }
      cli('r2', 'bucket', 'delete', target.name, '--config', configPath)
    } else if (target.type === 'd1') {
      cli('d1', 'delete', target.id!, '--skip-confirmation', '--config', configPath)
    } else throw Error('Unexpected cleanup resource type.')
    receipt.deleted.push({...target, deletedAt: new Date().toISOString()})
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
  }
  console.log(JSON.stringify({receipt: receiptPath, deleted: receipt.deleted.length}))
} finally { await proxy.dispose() }
