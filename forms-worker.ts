// @ts-ignore OpenNext generates this module after Next's type check.
import handler from './.open-next/worker.js'
import { consumeCRMJobWakes, recoverCRMJobWakes, type CRMJobWake } from './src/crm/job-dispatch'
import { importJob } from './src/crm/import-job'
import { cleanImportResults } from './src/crm/import-export-maintenance'
import {
  PUBLIC_SITE_HEADER,
  PUBLIC_PREFIX_HEADER,
  PUBLIC_PREVIEW_HEADER,
  publicWebsite,
} from './src/organizations/public-website'
// @ts-ignore OpenNext generates these exports after Next's type check.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js'

export default {
  async queue(batch, env) {
    if (!env.CRM_JOB_QUEUE) throw new Error('CRM background dispatch is not configured.')
    await consumeCRMJobWakes(batch, env.D1, env.CRM_JOB_QUEUE, {
      'import-apply': importJob(env.D1, env.WORKSPACE_FILES),
    })
  },
  async fetch(request, env, ctx) {
    const headers = new Headers(request.headers)
    for (const key of [PUBLIC_SITE_HEADER, PUBLIC_PREFIX_HEADER, PUBLIC_PREVIEW_HEADER])
      headers.delete(key)
    const cleanRequest = new Request(request, { headers })
    const url = new URL(request.url)
    const key = /^\/sites\/([a-zA-Z0-9_-]{1,80})(?:\/|$)/.exec(url.pathname)?.[1]
    if (!key) return handler.fetch(cleanRequest, env, ctx)
    const site = await env.D1.prepare("SELECT id FROM vc_sites WHERE route_key=? AND id!='default'")
      .bind(key)
      .first<{ id: string }>()
    const preview = url.searchParams.get('preview') === '1'
    const before = site && (await publicWebsite(env.D1, site.id, preview))
    if (!before)
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    if (preview) {
      const authorization = new URL('/api/organization-admin', url)
      authorization.searchParams.set('site', site!.id)
      authorization.searchParams.set('website', '1')
      const permitted = await handler.fetch(new Request(authorization, { headers }), env, ctx)
      const allowed = permitted.ok
      await permitted.body?.cancel()
      if (!allowed)
        return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    const path = url.pathname.replace(/^\/sites\/[a-zA-Z0-9_-]{1,80}/, '') || '/'
    if (
      path.startsWith('/admin') ||
      (path.startsWith('/api/') &&
        !/^\/api\/(forms-runtime|forms-embed|forms-surveys|forms-payments|forms-placement|media\/file|menu-render|block-listing|content-views|public\/authors)(\/|$)/.test(
          path,
        ))
    )
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    headers.set(PUBLIC_SITE_HEADER, site!.id)
    headers.set(PUBLIC_PREFIX_HEADER, `/sites/${key}`)
    if (preview) headers.set(PUBLIC_PREVIEW_HEADER, '1')
    const response = await handler.fetch(new Request(cleanRequest, {headers}), env, ctx)
    const after = await publicWebsite(env.D1, site!.id, preview)
    if (!after || after.authority_revision !== before.authority_revision) {
      await response.body?.cancel()
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('Cache-Control', 'private, no-store')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  },
  async scheduled(_event, env, ctx) {
    // Call the same bounded, leased processor as manual recovery, without a
    // public network hop. The token remains a Worker secret.
    if (!env.FORM_JOB_TOKEN || env.FORM_JOB_TOKEN.length < 32)
      throw new Error('Forms scheduled processing requires FORM_JOB_TOKEN.')
    const failures: string[] = []
    for (const path of [
      '/api/forms-actions/tick',
      '/api/review-tasks/notifications/tick',
      '/api/task-workspace/maintenance',
      '/api/crm/jobs/tick',
    ]) {
      try {
        const response = await handler.fetch(
          new Request(`https://jobs.internal${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.FORM_JOB_TOKEN}` },
          }),
          env,
          ctx,
        )
        if (!response.ok) failures.push(`${path}: ${response.status}`)
        await response.body?.cancel()
      } catch {
        failures.push(`${path}: failed`)
      }
    }
    if (env.CRM_JOB_QUEUE) {
      try {
        await recoverCRMJobWakes(env.D1, env.CRM_JOB_QUEUE, ['import-apply'])
        const cleanup = await cleanImportResults(env.D1, env.WORKSPACE_FILES)
        if (cleanup.uploadFailures) failures.push('CRM result upload cleanup: retry required')
      } catch {
        failures.push('CRM background recovery: failed')
      }
    }
    if (failures.length) throw new Error(`Scheduled processing failed: ${failures.join(', ')}`)
  },
} satisfies ExportedHandler<CloudflareEnv & { FORM_JOB_TOKEN?: string; CRM_JOB_QUEUE?: Queue<CRMJobWake> }>
