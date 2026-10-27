/** Drain streamed pages without retaining content or canceling Worker execution. */
export async function consumeHealthResponse(response) {
  if (!response.body) return
  const reader = response.body.getReader()
  try {
    while (!(await reader.read()).done) {
      // Fully consume each chunk so Cloudflare can report the completed response.
    }
  } finally {
    reader.releaseLock()
  }
}

/** Decode Wrangler's streamed JSON without persisting request headers or log bodies. */
export function jsonEventDecoder(accept) {
  let buffer = ''
  return (chunk) => {
    buffer += chunk.toString()
    if (buffer.length > 2 * 1024 * 1024) throw Error('Telemetry buffer exceeded its limit.')
    for (;;) {
      const begin = buffer.indexOf('{')
      if (begin < 0) {
        buffer = ''
        return
      }
      let depth = 0,
        quoted = false,
        escaped = false,
        end = -1
      for (let index = begin; index < buffer.length; index++) {
        const character = buffer[index]
        if (escaped) {
          escaped = false
          continue
        }
        if (quoted && character === '\\') {
          escaped = true
          continue
        }
        if (character === '"') {
          quoted = !quoted
          continue
        }
        if (!quoted) {
          if (character === '{') depth++
          if (character === '}' && --depth === 0) {
            end = index + 1
            break
          }
        }
      }
      if (end < 0) {
        buffer = buffer.slice(begin)
        return
      }
      const event = JSON.parse(buffer.slice(begin, end))
      buffer = buffer.slice(end)
      accept(event)
    }
  }
}

/** Every probe must have an expected HTTP response AND a corresponding live event. */
export class HealthObservation {
  constructor(origin, maximumLag = 30000) {
    this.origin = origin
    this.maximumLag = maximumLag
    this.probes = new Map()
    this.startedAt = null
    this.lastProbeAt = null
    this.tailEvents = 0
    this.exceptions = 0
    this.serverErrors = 0
    this.failure = ''
  }
  register(id, pathname, expectedStatus, now) {
    if (this.probes.has(id)) throw Error('Duplicate health probe identity.')
    this.probes.set(id, { pathname, expectedStatus, sentAt: now, status: null, telemetryAt: null })
    this.lastProbeAt = now
  }
  response(id, status) {
    const probe = this.probes.get(id)
    if (!probe) throw Error('Unknown health probe.')
    probe.status = status
    if (status >= 500) this.serverErrors++
    if (status !== probe.expectedStatus)
      this.failure = 'A functional health probe returned an unexpected status.'
  }
  event(event, now) {
    if (!event.outcome && !event.eventTimestamp) return
    this.tailEvents++
    this.exceptions +=
      event.exceptions?.length ||
      (event.outcome && !['ok', 'canceled'].includes(event.outcome) ? 1 : 0)
    if (event.event?.response?.status >= 500) this.serverErrors++
    const requestURL = event.event?.request?.url
    if (!requestURL) return
    let url
    try {
      url = new URL(requestURL)
    } catch {
      return
    }
    if (url.origin !== this.origin) return
    // Wrangler sanitizes query values. Keep its sanitization enabled and put
    // the non-sensitive correlation marker in the parameter name instead.
    const markers = [...url.searchParams.keys()].filter((key) =>
      key.startsWith('__vorti_release_probe_'),
    )
    if (markers.length !== 1) return
    const probe = this.probes.get(markers[0].slice('__vorti_release_probe_'.length))
    if (!probe || probe.pathname !== url.pathname) return
    probe.telemetryAt ??= now
    if (event.event.response?.status !== probe.expectedStatus)
      this.failure = 'Live telemetry did not confirm the expected probe response.'
  }
  assertHealthy(now, allConfirmed = false) {
    if (this.failure || this.exceptions || this.serverErrors)
      throw Error(this.failure || 'Live application errors were observed.')
    if (this.startedAt !== null && now - this.lastProbeAt > this.maximumLag)
      throw Error('Periodic health probes stopped during observation.')
    for (const probe of this.probes.values()) {
      if (probe.telemetryAt !== null && probe.telemetryAt - probe.sentAt > this.maximumLag)
        throw Error('Probe telemetry exceeded the allowed coverage gap.')
      if (probe.telemetryAt === null && (allConfirmed || now - probe.sentAt > this.maximumLag))
        throw Error('A health probe has no timely corresponding live telemetry.')
      if (allConfirmed && probe.status === null) throw Error('A probe has no HTTP response.')
    }
  }
  start(now) {
    this.assertHealthy(now, true)
    if (!this.probes.size || this.startedAt !== null)
      throw Error('Confirm telemetry before starting observation.')
    this.startedAt = now
  }
  finish(now) {
    this.assertHealthy(now, true)
    if (this.startedAt === null || now - this.startedAt < 600000)
      throw Error('At least 600 continuous seconds are required.')
    return {
      passed: true,
      startedAt: new Date(this.startedAt).toISOString(),
      healthSeconds: Math.floor((now - this.startedAt) / 1000),
      tailEvents: this.tailEvents,
      exceptions: this.exceptions,
      serverErrors: this.serverErrors,
      confirmedProbes: this.probes.size,
      probes: [...this.probes.values()].map((probe) => ({
        ...probe,
        sentAt: new Date(probe.sentAt).toISOString(),
        telemetryAt: new Date(probe.telemetryAt).toISOString(),
      })),
    }
  }
}
