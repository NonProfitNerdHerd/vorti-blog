import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'
import { HealthObservation, jsonEventDecoder } from './lib/health-observation.mjs'

const args = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index],
    value = process.argv[index + 1]
  if (!['--config', '--url', '--receipt', '--expected-worker'].includes(key) || !value || args[key])
    throw Error('Invalid health observation arguments.')
  args[key] = value
}
if (process.versions.node !== readFileSync('.node-version', 'utf8').trim().replace(/^v/, ''))
  throw Error('Use the pinned Node runtime.')
const config = ts.parseConfigFileTextToJson(
  args['--config'],
  readFileSync(args['--config'], 'utf8'),
)
const base = new URL(args['--url'])
if (
  config.error ||
  config.config.name !== args['--expected-worker'] ||
  base.protocol !== 'https:' ||
  base.username ||
  base.password ||
  base.pathname !== '/' ||
  base.search ||
  base.hash ||
  existsSync(args['--receipt'])
)
  throw Error('Use a verified production target and a new receipt path.')
const observation = new HealthObservation(base.origin)
let disconnected = false,
  decodingFailed = false
const tail = spawn(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'tail',
    '--config',
    args['--config'],
    '--format',
    'json',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
)
tail.on('exit', () => {
  disconnected = true
})
tail.on('error', () => {
  disconnected = true
})
tail.stderr.on('data', () => {})
const decode = jsonEventDecoder((event) => observation.event(event, Date.now()))
tail.stdout.on('data', (chunk) => {
  try {
    decode(chunk)
  } catch {
    decodingFailed = true
  }
})
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = () => {
  if (disconnected || decodingFailed)
    throw Error('Live telemetry disconnected or could not be decoded.')
  observation.assertHealthy(Date.now())
}
const probe = async (pathname, expectedStatus) => {
  const id = crypto.randomUUID(),
    url = new URL(pathname, base)
  url.searchParams.set(`__vorti_release_probe_${id}`, '1')
  observation.register(id, pathname, expectedStatus, Date.now())
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(10000),
  })
  observation.response(id, response.status)
  await response.body?.cancel()
  check()
}
let receipt
try {
  // Allow Wrangler to attach before sending the first correlated request.
  await sleep(5000)
  await probe('/', 200)
  const connectionDeadline = Date.now() + 30000
  while (
    [...observation.probes.values()].some((item) => item.telemetryAt === null) &&
    Date.now() < connectionDeadline
  ) {
    check()
    await sleep(1000)
  }
  observation.start(Date.now())
  console.log('Live probe telemetry confirmed; starting the ten-minute observation.')
  let nextProbe = 0
  while (Date.now() - observation.startedAt < 610000) {
    check()
    if (Date.now() >= nextProbe) {
      for (const [pathname, status] of [
        ['/', 200],
        ['/admin/login', 200],
        ['/wiki', 200],
        ['/intranet', 404],
      ])
        await probe(pathname, status)
      nextProbe = Date.now() + 15000
    }
    await sleep(1000)
  }
  while ([...observation.probes.values()].some((item) => item.telemetryAt === null)) {
    check()
    await sleep(1000)
  }
  check()
  receipt = observation.finish(Date.now())
} catch {
  receipt = {
    passed: false,
    failure: 'Health or continuous probe telemetry validation failed; retain recovery resources.',
    healthSeconds:
      observation.startedAt === null ? 0 : Math.floor((Date.now() - observation.startedAt) / 1000),
    exceptions: observation.exceptions,
    serverErrors: observation.serverErrors,
    tailEvents: observation.tailEvents,
    confirmedProbes: [...observation.probes.values()].filter((item) => item.telemetryAt !== null)
      .length,
  }
  process.exitCode = 1
} finally {
  tail.kill()
  receipt = {
    worker: config.config.name,
    url: base.origin,
    ...receipt,
    finishedAt: new Date().toISOString(),
  }
  writeFileSync(args['--receipt'], JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      healthSeconds: receipt.healthSeconds,
      exceptions: receipt.exceptions,
      serverErrors: receipt.serverErrors,
      confirmedProbes: receipt.confirmedProbes,
    }),
  )
}
