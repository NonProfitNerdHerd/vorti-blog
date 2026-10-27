import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { verifyArtifact } from './lib/release-artifact.mjs'

const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  if (!['--artifact', '--manifest', '--config', '--validation', '--browser-report', '--lease', '--expected-worker', '--expected-deployment', '--receipt'].includes(key) || !value || args[key]) throw Error('Invalid immutable deployment arguments.')
  args[key] = value
}
if (process.versions.node !== readFileSync('.node-version', 'utf8').trim().replace(/^v/, '')) throw Error('Use the pinned Node runtime.')
execFileSync(process.execPath, ['scripts/require-production-intent.mjs', 'deployment'], {stdio: 'inherit'})
const artifact = path.resolve(args['--artifact']), manifest = JSON.parse(readFileSync(args['--manifest'], 'utf8'))
const validation = JSON.parse(readFileSync(args['--validation'], 'utf8'))
const browser = JSON.parse(readFileSync(args['--browser-report'], 'utf8'))
if (validation.status !== 'passed' || validation.source !== manifest.sourceCommit || validation.archiveHash !== manifest.sourceHash || !['typescript', 'lint', 'design-editor', 'integration'].every(stage => validation.records.some(record => record.stage === stage && record.exitCode === 0))) throw Error('Frozen validation does not match this artifact.')
if (browser.config?.metadata?.artifactHash !== manifest.artifactHash || browser.config?.metadata?.sourceCommit !== manifest.sourceCommit || !browser.stats?.expected || browser.stats.unexpected || browser.stats.skipped || browser.errors?.length) throw Error('Complete passing browser acceptance against this artifact is required.')
const git = (...parameters) => execFileSync('git', parameters, {encoding: 'utf8'}).trim()
if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== manifest.sourceCommit || git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0] !== manifest.sourceCommit) throw Error('Commit and push the validated source before deployment; do not overwrite newer source.')
verifyArtifact(artifact, manifest, manifest)
const configPath = path.resolve(args['--config'])
const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'))
if (parsed.error || parsed.config.name !== args['--expected-worker']) throw Error('Deployment target mismatch.')
const config = parsed.config, lease = JSON.parse(readFileSync(args['--lease'], 'utf8'))
if (!/^[a-f0-9-]{36}$/.test(lease.id) || lease.target !== config.name || lease.phase !== 'cutover' || !Number.isSafeInteger(lease.revision)) throw Error('A cutover lease is required.')
const cli = (...parameters) => execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...parameters], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
const state = JSON.parse(cli('d1', 'execute', 'OPERATIONS', '--remote', '--config', configPath, '--json', '--command', `SELECT id FROM release_runs WHERE id='${lease.id}' AND phase='cutover' AND revision=${lease.revision}`))
if (state[0]?.results?.[0]?.id !== lease.id) throw Error('The operational lease changed. Retain maintenance and reconcile.')
const current = () => JSON.parse(cli('deployments', 'list', '--config', configPath, '--json')).sort((a,b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0]
if (current()?.id !== args['--expected-deployment']) throw Error('Production advanced immediately before upload. Reconcile before deploying.')
const upload = {...config, main: path.join(artifact, manifest.entrypoint), no_bundle: true, find_additional_modules: true, assets: {...config.assets, directory: path.join(artifact, 'assets')}}
delete upload.build
delete upload.$schema
const uploadPath = configPath + '.immutable.json'
writeFileSync(uploadPath, JSON.stringify(upload, null, 2) + '\n', {flag: 'wx'})
const output = cli('deploy', '--config', uploadPath)
verifyArtifact(artifact, manifest, manifest)
const deployed = current()
if (!deployed || deployed.id === args['--expected-deployment'] || deployed.versions.length !== 1 || deployed.versions[0].percentage !== 100) throw Error('Deployment outcome is uncertain. Retain maintenance and inspect live state.')
writeFileSync(path.resolve(args['--receipt']), JSON.stringify({worker: config.name, source: manifest.sourceCommit, artifactHash: manifest.artifactHash, deployment: deployed.id, workerVersion: deployed.versions[0].version_id, deployedAt: deployed.created_on, liveVerified: false}, null, 2) + '\n', {flag: 'wx'})
console.log(output)
