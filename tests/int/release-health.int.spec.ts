import { expect, it } from 'vitest'
import {
  consumeHealthResponse,
  HealthObservation,
  jsonEventDecoder,
} from '../../scripts/lib/health-observation.mjs'
const origin = 'https://example.com'
it('fully drains streamed health pages without canceling execution or retaining a reader lock', async () => {
  let chunks = 0,
    canceled = false
  const body = new ReadableStream({
    pull(controller) {
      if (chunks++ < 3) controller.enqueue(new Uint8Array([1, 2, 3]))
      else controller.close()
    },
    cancel() {
      canceled = true
    },
  })
  await consumeHealthResponse(new Response(body))
  expect(chunks).toBe(4)
  expect(canceled).toBe(false)
  expect(body.locked).toBe(false)
})
it('rejects interrupted response streams so incomplete probes cannot pass', async () => {
  const body = new ReadableStream({
    pull(controller) {
      controller.error(new Error('Stream interrupted'))
    },
  })
  await expect(consumeHealthResponse(new Response(body))).rejects.toThrow('Stream interrupted')
  expect(body.locked).toBe(false)
})
const event = (id: string, status = 200) => ({
  outcome: 'ok',
  event: {
    request: { url: `${origin}/?__vorti_release_probe_${id}=REDACTED` },
    response: { status },
  },
})
it('starts only after correlated telemetry and requires a complete ten-minute window', () => {
  const health = new HealthObservation(origin)
  expect(() => health.start(0)).toThrow()
  health.register('warmup', '/', 200, 1000)
  health.response('warmup', 200)
  expect(() => health.start(1001)).toThrow('telemetry')
  health.event(event('warmup'), 2000)
  health.start(2000)
  expect(() => health.finish(602000)).toThrow('Periodic health probes stopped')
  for (let index = 1; index < 40; index++) {
    const id = `probe-${index}`,
      now = 2000 + index * 15000
    health.register(id, '/', 200, now)
    health.response(id, 200)
    health.event(event(id), now)
  }
  expect(() => health.finish(601999)).toThrow('600 continuous')
  expect(health.finish(602000)).toMatchObject({
    passed: true,
    healthSeconds: 600,
    confirmedProbes: 40,
  })
})
it('rejects missing or excessively delayed probe coverage even when other events arrive', () => {
  const health = new HealthObservation(origin)
  health.register('missing', '/', 200, 0)
  health.response('missing', 200)
  health.event(event('unrelated'), 15000)
  expect(() => health.assertHealthy(30001)).toThrow('telemetry')
  health.event(event('missing'), 30002)
  expect(() => health.assertHealthy(30003)).toThrow('coverage gap')
})
it('rejects unexpected functional responses and exceptions outside probe requests', () => {
  const health = new HealthObservation(origin)
  health.register('bad', '/', 200, 0)
  health.response('bad', 404)
  expect(() => health.assertHealthy(1)).toThrow('unexpected status')
  const exception = new HealthObservation(origin)
  exception.event({ outcome: 'exception', exceptions: [{ name: 'Error' }] }, 0)
  expect(() => exception.assertHealthy(1)).toThrow('application errors')
})
it('does not accept the wrong origin, path, or response as probe confirmation', () => {
  const health = new HealthObservation(origin)
  health.register('probe', '/', 200, 0)
  health.response('probe', 200)
  health.event(
    {
      ...event('probe'),
      event: {
        request: { url: 'https://other.com/?__vorti_release_probe_probe=REDACTED' },
        response: { status: 200 },
      },
    },
    1,
  )
  expect(() => health.start(2)).toThrow('telemetry')
  health.event(event('probe', 500), 3)
  expect(() => health.assertHealthy(4)).toThrow()
})
it('decodes fragmented JSON events with escaped quotes and braces in private log messages', () => {
  const received: unknown[] = []
  const decode = jsonEventDecoder((value: unknown) => received.push(value))
  const first = { outcome: 'ok', logs: [{ message: 'private { content "quoted" }' }] }
  const serialized = JSON.stringify(first)
  decode('Connecting…\n' + serialized.slice(0, 19))
  expect(received).toEqual([])
  decode(serialized.slice(19) + '\n' + JSON.stringify(event('two')))
  expect(received).toEqual([first, event('two')])
})
