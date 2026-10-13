import { resolve4, resolve6 } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'
import { hmac } from './security'

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19))
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase()
    // Only global unicast IPv6; mapped IPv4 and local/special ranges are excluded.
    return /^[23][0-9a-f]{3}:/.test(normalized) && !normalized.startsWith('2001:db8:') && !/^2001:(?:0:|:)/.test(normalized) && !normalized.startsWith('2002:')
  }
  return false
}
export function validateWebhookURL(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) throw new Error('Webhooks require HTTPS on port 443 without embedded credentials or fragments.')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host.includes('.') && !isIP(host) || ['localhost', 'metadata.google.internal'].includes(host) || /\.(localhost|local|internal|test|invalid)$/.test(host) || (isIP(host) && !publicAddress(host))) throw new Error('Webhook destination must be publicly routable.')
  return url
}
export interface WebhookDelivery { url: string; eventID: string; body: string; secret: string; authorization?: string }
/** DNS results are pinned in Node; Workers' public-only fetch enforces the network boundary. No redirects are followed. */
export async function deliverWebhook(delivery: WebhookDelivery): Promise<{ status: number }> {
  const url = validateWebhookURL(delivery.url), host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : (await Promise.allSettled([resolve4(host), resolve6(host)])).flatMap(result => result.status === 'fulfilled' ? result.value : [])
  if (!addresses.length || addresses.some(address => !publicAddress(address))) throw new Error('Webhook DNS must resolve only to public addresses.')
  const timestamp = String(Math.floor(Date.now() / 1000)), signature = await hmac(delivery.secret, `${timestamp}.${delivery.body}`)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Form-Event': delivery.eventID, 'Idempotency-Key': delivery.eventID, 'X-Form-Timestamp': timestamp, 'X-Form-Signature': `v1=${signature}` }
  if (delivery.authorization) {
    if (/[\r\n]/.test(delivery.authorization)) throw new Error('Invalid authorization header.')
    headers.Authorization = delivery.authorization
  }
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Cloudflare-Workers')) {
    const result = await fetch(url, { method: 'POST', headers, body: delivery.body, redirect: 'manual', signal: AbortSignal.timeout(10000) })
    await result.body?.cancel()
    if (result.status < 200 || result.status >= 300) throw new Error(`Webhook returned HTTP ${result.status}.`)
    return { status: result.status }
  }
  return new Promise((resolve, reject) => {
    const pinned = addresses[0]
    const request = httpsRequest(url, { method: 'POST', headers, timeout: 10000, lookup: (_hostname, _options, callback) => callback(null, pinned, isIP(pinned)) }, result => {
      result.resume()
      const status = result.statusCode || 500
      if (status >= 200 && status < 300) resolve({ status }); else reject(new Error(`Webhook returned HTTP ${status}.`))
    })
    request.on('timeout', () => request.destroy(new Error('Webhook timed out.')))
    request.on('error', reject); request.end(delivery.body)
  })
}
