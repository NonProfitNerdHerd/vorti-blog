import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'
import { createArtifactManifest, verifyArtifact } from './lib/release-artifact.mjs'

const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  if (!['--config', '--validation', '--output'].includes(key) || !value || args[key]) throw Error('Use --config <isolated-config> --validation <receipt> --output <new-directory>.')
  args[key] = value
}
if (process.platform !== 'linux' || process.versions.node !== readFileSync('.node-version', 'utf8').trim().replace(/^v/, '')) throw Error('Package inside the pinned Linux release runtime.')
const validation = JSON.parse(readFileSync(args['--validation'], 'utf8'))
if (validation.status !== 'passed' || !/^[a-f0-9]{40}$/.test(validation.source)) throw Error('Passing frozen-source validation is required.')
const sourceFiles = JSON.parse(readFileSync('/tmp/source-files.json', 'utf8'))
const sourceDigest = createHash('sha256')
for (const file of sourceFiles) sourceDigest.update(file + '\0').update(readFileSync(file)).update('\0')
if (sourceDigest.digest('hex') !== readFileSync('/tmp/source-hash', 'utf8')) throw Error('Source changed after frozen validation.')
if (createHash('sha256').update(readFileSync('/tmp/source.tar')).digest('hex') !== validation.archiveHash) throw Error('Validation receipt does not match this runtime source archive.')
const configPath = path.resolve(args['--config'])
const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'))
if (parsed.error) throw Error('Invalid isolated configuration.')
const config = parsed.config
if (!config.name.endsWith('-local-test') || config.d1_databases?.some(item => item.remote)) throw Error('Package against isolated local bindings.')
const output = path.resolve(args['--output'])
mkdirSync(output, {recursive: false})
const artifact = path.join(output, 'artifact'), worker = path.join(artifact, 'worker')
mkdirSync(worker, {recursive: true})
execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', configPath, '--dry-run', '--outdir', worker], {stdio: 'inherit', env: {...process.env, WRANGLER_SEND_METRICS: 'false'}})
cpSync(path.resolve(path.dirname(configPath), config.assets.directory), path.join(artifact, 'assets'), {recursive: true, dereference: false})
const entrypoint = `worker/${path.basename(config.main).replace(/\.[^.]+$/, '.js')}`
const hash = value => createHash('sha256').update(value).digest('hex')
const migrations = execFileSync(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs';import crypto from 'node:crypto';const files=fs.readdirSync('src/migrations').filter(f=>f.endsWith('.ts')).sort();console.log(crypto.createHash('sha256').update(files.map(f=>f+'\\0'+fs.readFileSync('src/migrations/'+f,'utf8').replaceAll('\\r\\n','\\n')).join('\\0')).digest('hex'));`], {encoding: 'utf8'}).trim()
const identity = {sourceCommit: validation.source, sourceHash: validation.archiveHash, configurationHash: hash(readFileSync(configPath)), migrationHash: migrations, entrypoint}
const manifest = createArtifactManifest(artifact, identity)
verifyArtifact(artifact, manifest, identity)
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'})
const preview = {...config, main: path.join(artifact, entrypoint), no_bundle: true, find_additional_modules: true, assets: {...config.assets, directory: path.join(artifact, 'assets')}}
delete preview.build
delete preview.$schema
writeFileSync(path.join(output, 'preview.json'), JSON.stringify(preview, null, 2) + '\n', {flag: 'wx'})
console.log(JSON.stringify({artifactHash: manifest.artifactHash, entrypoint, preview: path.join(output, 'preview.json')}))
