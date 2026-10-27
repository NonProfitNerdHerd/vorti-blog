import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const options = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  if (
    !['--source', '--image', '--dependency-volume', '--output'].includes(key) ||
    !process.argv[index + 1] ||
    options[key]
  )
    throw Error(
      'Use --source <commit> --image <pinned-image> --output <new-directory> [--dependency-volume <cache>].',
    )
  options[key] = process.argv[index + 1]
}
const source = options['--source']
if (!/^[a-f0-9]{40}$/.test(source || '') || !options['--output'] || !options['--image'])
  throw Error('An exact source commit, runtime image and output directory are required.')
const node = readFileSync(path.join(root, '.node-version'), 'utf8').trim().replace(/^v/, '')
if (process.versions.node !== node) throw Error(`Use pinned Node ${node}.`)
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
if (git('rev-parse', `${source}^{commit}`) !== source)
  throw Error('Source commit does not resolve.')
const output = path.resolve(root, options['--output'])
mkdirSync(output, { recursive: false })
const archive = path.join(output, 'source.tar')
execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, source], { cwd: root })
const archiveHash = createHash('sha256').update(readFileSync(archive)).digest('hex')
const trackedFiles = git('ls-tree', '-r', '--name-only', source).split('\n')
const trackedFile = path.join(output, 'source-files.json')
writeFileSync(trackedFile, JSON.stringify(trackedFiles))
const name = `vorti-validation-${randomUUID()}`
const records = []
const run = async (stage, args) => {
  console.log(`${stage}: running`)
  const startedAt = new Date().toISOString()
  const logfile = path.join(output, `${stage}.log`)
  const log = createWriteStream(logfile, { flags: 'wx' })
  const status = await new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    child.once('error', (error) => {
      log.end()
      reject(error)
    })
    child.once('close', (code) => log.end(() => resolve(code)))
  })
  records.push({
    stage,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: status,
    logHash: createHash('sha256').update(readFileSync(logfile)).digest('hex'),
  })
  writeFileSync(
    path.join(output, 'progress.json'),
    JSON.stringify({ source, archiveHash, container: name, records }, null, 2) + '\n',
  )
  if (status !== 0)
    throw Error(
      `${stage} failed. Inspect ${logfile}. The isolated runtime is retained for diagnosis.`,
    )
  console.log(`${stage}: passed`)
}
await run('create-volume', ['volume', 'create', name])
await run('create-runtime', [
  'run',
  '-d',
  '--name',
  name,
  '-v',
  `${name}:/build`,
  ...(options['--dependency-volume']
    ? ['-v', `${options['--dependency-volume']}:/dependency-cache:ro`]
    : []),
  options['--image'],
])
await run('copy-source', ['cp', archive, `${name}:/tmp/source.tar`])
await run('extract-source', ['exec', name, 'tar', '-xf', '/tmp/source.tar', '-C', '/build'])
await run('copy-source-inventory', ['cp', trackedFile, `${name}:/tmp/source-files.json`])
const fingerprintSource =
  'import fs from "node:fs"; import crypto from "node:crypto"; const files=JSON.parse(fs.readFileSync("/tmp/source-files.json","utf8")); const digest=crypto.createHash("sha256"); for(const file of files){digest.update(file+"\\0");digest.update(fs.readFileSync(file));digest.update("\\0");} const hash=digest.digest("hex");'
await run('freeze-inputs', [
  'exec',
  '-w',
  '/build',
  name,
  'node',
  '--input-type=module',
  '-e',
  fingerprintSource + 'fs.writeFileSync("/tmp/source-hash",hash);console.log(hash);',
])
if (options['--dependency-volume'])
  await run('copy-dependencies', [
    'exec',
    name,
    'cp',
    '-a',
    '/dependency-cache/node_modules',
    '/build/node_modules',
  ])
await run('dependencies', [
  'exec',
  '-w',
  '/build',
  name,
  'pnpm',
  'install',
  '--frozen-lockfile',
  '--ignore-scripts',
  ...(options['--dependency-volume'] ? ['--offline'] : []),
])
await run('runtime-identity', [
  'exec',
  '-w',
  '/build',
  name,
  'node',
  '--input-type=module',
  '-e',
  'import fs from "node:fs"; import cp from "node:child_process"; const expected=fs.readFileSync(".node-version","utf8").trim().replace(/^v/,""); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); const pnpm=cp.execFileSync("pnpm",["--version"],{encoding:"utf8"}).trim(); if(process.versions.node!==expected||pkg.packageManager.split("+")[0]!==`pnpm@${pnpm}`)throw Error("Runtime mismatch"); console.log(JSON.stringify({node:process.versions.node,pnpm,platform:process.platform})); if(process.platform!=="linux")throw Error("Linux release runtime required");',
])
await run('generated-bindings', [
  'exec',
  '-w',
  '/build',
  name,
  'pnpm',
  'run',
  'generate:types:cloudflare',
])
await run('verify-generated-inputs', [
  'exec',
  '-w',
  '/build',
  name,
  'node',
  '--input-type=module',
  '-e',
  fingerprintSource +
    'if(fs.readFileSync("/tmp/source-hash","utf8")!==hash)throw Error("Binding generation changed frozen source");console.log(hash);',
])
for (const [stage, command] of [
  ['typescript', ['pnpm', 'exec', 'tsc', '--noEmit']],
  ['lint', ['pnpm', 'exec', 'eslint', '.', '--quiet']],
  [
    'design-editor',
    ['pnpm', '--filter', '@design-system/payload-design-core', 'test', '--maxWorkers', '2'],
  ],
  ['integration', ['pnpm', 'run', 'test:int']],
])
  await run(stage, ['exec', '-e', 'VORTI_FROZEN_VALIDATION=1', '-w', '/build', name, ...command])
await run('verify-inputs', [
  'exec',
  '-w',
  '/build',
  name,
  'node',
  '--input-type=module',
  '-e',
  fingerprintSource +
    'if(fs.readFileSync("/tmp/source-hash","utf8")!==hash)throw Error("Tracked source changed during validation; commit generated outputs and rerun");console.log(hash);',
])
const image = execFileSync('docker', ['inspect', '--format', '{{.Image}}', name], {
  encoding: 'utf8',
}).trim()
writeFileSync(
  path.join(output, 'validation.json'),
  JSON.stringify(
    {
      source,
      archiveHash,
      runtimeImage: image,
      container: name,
      volume: name,
      completedAt: new Date().toISOString(),
      records,
      status: 'passed',
      scope: ['typescript', 'lint', 'design-editor', 'integration'],
      // Browser, build, packaging and live acceptance are separate mandatory release gates.
      releaseReady: false,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
)
console.log(`Frozen-source validation passed. Evidence: ${output}`)
