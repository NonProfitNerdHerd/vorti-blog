import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'
import { validateReleaseTarget } from './lib/release-target.mjs'

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]
  if (key === '--discard-development-data') { args[key] = true; continue }
  if (!['--mode', '--baseline', '--validation', '--expected-worker', '--output'].includes(key) || !process.argv[i + 1] || args[key]) throw Error('Invalid provisioning arguments.')
  args[key] = process.argv[++i]
}
const mode = args['--mode'], worker = args['--expected-worker']
if (!['install', 'upgrade', 'development-reset'].includes(mode) || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(worker || '')) throw Error('Choose a mode and exact Worker name of at most 40 characters.')
if ((mode === 'development-reset') !== (args['--discard-development-data'] === true)) throw Error('Only development-reset requires --discard-development-data.')
if (process.versions.node !== readFileSync('.node-version', 'utf8').trim().replace(/^v/, '')) throw Error('Use the pinned Node runtime.')
const baseline = JSON.parse(readFileSync(args['--baseline'], 'utf8'))
const validation = JSON.parse(readFileSync(args['--validation'], 'utf8'))
const source = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim()
if (validation.status !== 'passed' || validation.source !== source || !['typescript', 'lint', 'design-editor', 'integration'].every(stage => validation.records.some(record => record.stage === stage && record.exitCode === 0))) throw Error('A passing frozen-source validation receipt for HEAD is required.')
const output = path.resolve(args['--output']), journalPath = output + '.provisioning.json'
if (existsSync(output) || existsSync(journalPath)) throw Error('Use new output paths. An interrupted provision requires inspecting its journal and resources before retrying.')
const parse = file => {
  const parsed = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'))
  if (parsed.error) throw Error('Invalid Worker configuration.')
  return parsed.config
}
const config = parse('wrangler.jsonc')
if (config.name !== worker || baseline.worker !== worker) throw Error('Worker identity mismatch.')
const wrangler = (...parameters) => execFileSync(process.execPath, [path.resolve('node_modules/wrangler/bin/wrangler.js'), ...parameters], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, WRANGLER_SEND_METRICS: 'false'}})
if (mode !== 'install') {
  const deployments = JSON.parse(wrangler('deployments', 'list', '--json'))
  const current = deployments.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0]
  if (current.id !== baseline.deployment || current.versions.length !== 1 || current.versions[0].version_id !== baseline.version || current.versions[0].percentage !== 100) throw Error('Production advanced; reconcile before provisioning.')
} else if (baseline.deployment || baseline.resources.length) throw Error('Install requires an unused target.')
const prefix = `${worker}-${randomUUID().replaceAll('-', '').slice(0, 12)}`
const planned = mode === 'upgrade' ? [] : [
  {type: 'd1', binding: 'D1', name: `${prefix}-app`},
  {type: 'r2', binding: 'R2', name: `${prefix}-public`},
  {type: 'r2', binding: 'WORKSPACE_FILES', name: `${prefix}-private`},
]
if (!config.d1_databases?.some(item => item.binding === 'OPERATIONS')) planned.push({type: 'd1', binding: 'OPERATIONS', name: `${prefix}-ops`})
if (mode !== 'upgrade') {
  config.d1_databases = (config.d1_databases || []).filter(item => item.binding !== 'D1')
  config.r2_buckets = (config.r2_buckets || []).filter(item => !['R2', 'WORKSPACE_FILES'].includes(item.binding))
}
// Resolve source paths before moving configuration into the ignored release directory.
config.main = path.resolve(config.main)
if (config.assets?.directory) config.assets.directory = path.resolve(config.assets.directory)
delete config.$schema
config.vars = {...config.vars, RELEASE_TARGET: worker}
writeFileSync(output, JSON.stringify(config, null, 2) + '\n', {flag: 'wx'})
const journal = {worker, source, mode, createdAt: new Date().toISOString(), planned, completed: [], trafficSwitched: false}
const save = () => writeFileSync(journalPath, JSON.stringify(journal, null, 2) + '\n')
save()
for (const resource of planned) {
  const command = resource.type === 'd1' ? ['d1', 'create'] : ['r2', 'bucket', 'create']
  wrangler(...command, resource.name, '--config', output, '--binding', resource.binding, '--update-config', 'true', '--use-remote', 'true')
  journal.completed.push(resource)
  save()
}
const replacement = parse(output)
const resources = [
  ...replacement.d1_databases.map(item => ({binding: item.binding, type: 'd1', id: item.database_id, name: item.database_name})),
  ...replacement.r2_buckets.map(item => ({binding: item.binding, type: 'r2_bucket', name: item.bucket_name})),
  ...(replacement.queues?.producers || []).map(item => ({binding: item.binding, type: 'queue', name: item.queue})),
]
const targets = validateReleaseTarget({mode, discardDevelopmentData: args['--discard-development-data'] === true, expectedWorker: worker, baseline, replacement: {worker, resources}})
journal.resources = resources
journal.cleanupAfterVerification = targets.cleanup
journal.configurationHash = createHash('sha256').update(readFileSync(output)).digest('hex')
save()
console.log(JSON.stringify({configuration: output, journal: journalPath, trafficSwitched: false}))
