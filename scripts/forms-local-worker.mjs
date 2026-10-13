/** Development runner. Production scheduling must call the authenticated tick endpoint. */
const origin = new URL(process.env.FORM_LOCAL_ORIGIN || 'http://localhost:3105')
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('The local Forms runner only connects to loopback addresses.')
const token = process.env.FORM_JOB_TOKEN
if (!token || token.length < 32) throw new Error('Set FORM_JOB_TOKEN to the same random 32+ character secret used by the local app.')
let stopped = false
process.once('SIGINT', () => { stopped = true })
process.once('SIGTERM', () => { stopped = true })
while (!stopped) {
  try {
    const response = await fetch(new URL('/api/forms-actions/tick', origin), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) })
    if (!response.ok) console.error(`Forms local worker: HTTP ${response.status}`)
    else {
      const { processed } = await response.json()
      if (processed) console.log(`Forms local worker processed ${processed} durable action(s).`)
    }
  } catch { console.error('Forms local worker could not reach the local app; it will retry.') }
  if (!stopped) await new Promise(resolve => setTimeout(resolve, 5000))
}
