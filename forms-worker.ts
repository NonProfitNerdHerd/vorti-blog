// @ts-ignore OpenNext generates this module after Next's type check.
import handler from './.open-next/worker.js'
// @ts-ignore OpenNext generates these exports after Next's type check.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js'

export default {
  fetch: handler.fetch,
  async scheduled(_event, env, ctx) {
    // Call the same bounded, leased processor as manual recovery, without a
    // public network hop. The token remains a Worker secret.
    if (!env.FORM_JOB_TOKEN || env.FORM_JOB_TOKEN.length < 32) throw new Error('Forms scheduled processing requires FORM_JOB_TOKEN.')
    const failures: string[] = []
    for (const path of ['/api/forms-actions/tick', '/api/review-tasks/notifications/tick']) {
      try {
        const response = await handler.fetch(new Request(`https://jobs.internal${path}`, {
          method: 'POST', headers: { Authorization: `Bearer ${env.FORM_JOB_TOKEN}` },
        }), env, ctx)
        if (!response.ok) failures.push(`${path}: ${response.status}`)
        await response.body?.cancel()
      } catch { failures.push(`${path}: failed`) }
    }
    if (failures.length) throw new Error(`Scheduled processing failed: ${failures.join(', ')}`)
  },
} satisfies ExportedHandler<CloudflareEnv & { FORM_JOB_TOKEN?: string }>
