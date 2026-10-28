// @ts-ignore OpenNext generates this module after Next's type check.
import handler from './.open-next/worker.js'
import { consumeCRMJobWakes, recoverCRMJobWakes, type CRMJobWake } from './src/crm/job-dispatch'
import { importJob } from './src/crm/import-job'
import { cleanImportResults } from './src/crm/import-export-maintenance'
import {
  maintenanceRequired,
  maintenanceResponse,
  operationalProbe,
  type OperationsEnvironment,
} from './src/operations/maintenance'
import { reconcileRetiredCallback } from './src/operations/reconciliation'
import { tenantAuthorityActive } from './src/organizations/tenant-runtime'
import {
  PUBLIC_SITE_HEADER,
  PUBLIC_PREFIX_HEADER,
  PUBLIC_PREVIEW_HEADER,
  publicWebsite,
} from './src/organizations/public-website'
// @ts-ignore OpenNext generates these exports after Next's type check.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js'

function privateResponse(response: Response, internal = false) {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'private, no-store')
  if (internal) headers.set('X-Robots-Tag', 'noindex, nofollow')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default {
  async queue(batch, env) {
    if (await maintenanceRequired(env)) {
      batch.retryAll({ delaySeconds: 60 })
      return
    }
    if (!env.CRM_JOB_QUEUE) throw new Error('CRM background dispatch is not configured.')
    await consumeCRMJobWakes(batch, env.D1, env.CRM_JOB_QUEUE, {
      'import-apply': importJob(env.D1, env.WORKSPACE_FILES),
    })
  },
  async fetch(request, env, ctx) {
    try {
      const reconciled = await reconcileRetiredCallback(request, env)
      if (reconciled) return reconciled
      if ((await maintenanceRequired(env, request)) && !operationalProbe(request, env))
        return maintenanceResponse()
    } catch {
      return maintenanceResponse()
    }
    const headers = new Headers(request.headers)
    headers.delete('x-vorti-release-probe')
    for (const key of [PUBLIC_SITE_HEADER, PUBLIC_PREFIX_HEADER, PUBLIC_PREVIEW_HEADER])
      headers.delete(key)
    const cleanRequest = new Request(request, { headers })
    const url = new URL(request.url)
    const key = /^\/sites\/([a-zA-Z0-9_-]{1,80})(?:\/|$)/.exec(url.pathname)?.[1]
    if (!key) {
      const internal = /^\/(admin|wiki|intranet|_next)(\/|$)/.test(url.pathname)
      const publicAPI = /^\/api\/(forms-runtime|forms-embed|forms-surveys|forms-payments|forms-placement|media\/file|menu-render|block-listing|content-views|public\/authors)(\/|$)/.test(url.pathname)
      const internalForm = request.headers.get('x-vorti-form-host') === 'intranet' && /^\/api\/(forms-runtime|forms-embed|forms-surveys|forms-payments|forms-placement)(\/|$)/.test(url.pathname)
      const internalAPI = internalForm || (request.headers.get('x-vorticause-audience') === 'intranet' && /^\/api\/(menu-render|block-listing|content-views)(\/|$)/.test(url.pathname))
      if (internal || (url.pathname.startsWith('/api/') && (!publicAPI || internalAPI)) || !await tenantAuthorityActive(env.D1, 'default')) {
        if (internalForm) headers.set(PUBLIC_SITE_HEADER, 'default')
        const intranet = /^\/intranet(?:\/|$)/.test(url.pathname)
        if (intranet) {
          const site = url.searchParams.get('site') || 'default'
          if (!/^[a-zA-Z0-9_-]{1,80}$/.test(site)) return new Response('Not found', { status: 404 })
          headers.set(PUBLIC_SITE_HEADER, site)
        }
        const response = await handler.fetch(new Request(cleanRequest, { headers }), env, ctx)
        return intranet || url.pathname.startsWith('/api/') ? privateResponse(response, intranet || internalAPI) : response
      }
      const preview = url.searchParams.get('preview') === '1'
      const before = await publicWebsite(env.D1, 'default', preview)
      const unavailable = () => new Response('Not found', {status:404,headers:{'Cache-Control':'no-store'}})
      if (!before) return unavailable()
      if (preview) {
        const authorization = new URL('/api/organization-admin?site=default&website=1', url)
        const permitted = await handler.fetch(new Request(authorization, {headers}), env, ctx)
        const allowed = permitted.ok
        await permitted.body?.cancel()
        if (!allowed) return unavailable()
        headers.set(PUBLIC_PREVIEW_HEADER, '1')
      }
      headers.set(PUBLIC_SITE_HEADER, 'default')
      const response = await handler.fetch(new Request(cleanRequest, {headers}), env, ctx)
      const after = await publicWebsite(env.D1, 'default', preview)
      if (!after || after.authority_revision !== before.authority_revision) {
        await response.body?.cancel()
        return unavailable()
      }
      const responseHeaders = new Headers(response.headers)
      responseHeaders.set('Cache-Control', 'private, no-store')
      return new Response(response.body, {status:response.status,statusText:response.statusText,headers:responseHeaders})
    }
    const site = await env.D1.prepare("SELECT id FROM vc_sites WHERE route_key=? AND id!='default'")
      .bind(key)
      .first<{ id: string }>()
    const preview = url.searchParams.get('preview') === '1'
    const path = url.pathname.replace(/^\/sites\/[a-zA-Z0-9_-]{1,80}/, '') || '/'
    const internalContent = /^\/(wiki|intranet|api\/publishing|api\/knowledge)(\/|$)/.test(path) ||
      (request.headers.get('x-vorti-form-host') === 'intranet' && /^\/api\/(forms-runtime|forms-embed|forms-surveys|forms-payments|forms-placement)(\/|$)/.test(path)) ||
      (request.headers.get('x-vorticause-audience') === 'intranet' && /^\/api\/(menu-render|block-listing|content-views)(\/|$)/.test(path))
    const internalSite = async () =>
      site &&
      env.D1.prepare(
        `SELECT o.authority_revision FROM vc_sites s JOIN vc_organizations o ON o.id=s.organization_id WHERE s.id=? AND NOT EXISTS(SELECT 1 FROM vc_site_ancestry a JOIN vc_sites ancestor ON ancestor.id=a.ancestor_id WHERE a.descendant_id=s.id AND ancestor.archived=1)`,
      )
        .bind(site.id)
        .first<{ authority_revision: number }>()
    // Wiki/Intranet authorize their own published/private content. Public website
    // publication must not make authenticated internal content unavailable.
    const before = internalContent
      ? await internalSite()
      : site && (await publicWebsite(env.D1, site.id, preview))
    if (!before)
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    if (preview && !internalContent) {
      const authorization = new URL('/api/organization-admin', url)
      authorization.searchParams.set('site', site!.id)
      authorization.searchParams.set('website', '1')
      const permitted = await handler.fetch(new Request(authorization, { headers }), env, ctx)
      const allowed = permitted.ok
      await permitted.body?.cancel()
      if (!allowed)
        return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    if (
      path.startsWith('/admin') ||
      (path.startsWith('/api/') &&
        !/^\/api\/(forms-runtime|forms-embed|forms-surveys|forms-payments|forms-placement|media\/file|publishing\/(media|files)|knowledge|menu-render|block-listing|content-views|public\/authors)(\/|$)/.test(
          path,
        ))
    )
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    headers.set(PUBLIC_SITE_HEADER, site!.id)
    headers.set(PUBLIC_PREFIX_HEADER, `/sites/${key}`)
    if (preview) headers.set(PUBLIC_PREVIEW_HEADER, '1')
    const response = await handler.fetch(new Request(cleanRequest, { headers }), env, ctx)
    const after = internalContent
      ? await internalSite()
      : await publicWebsite(env.D1, site!.id, preview)
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
    if (await maintenanceRequired(env)) return
    // Call the same bounded, leased processor as manual recovery, without a
    // public network hop. The token remains a Worker secret.
    if (!env.FORM_JOB_TOKEN || env.FORM_JOB_TOKEN.length < 32)
      throw new Error('Forms scheduled processing requires FORM_JOB_TOKEN.')
    const failures: string[] = []
    for (const path of [
      '/api/forms-actions/tick',
      '/api/automations/tick',
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
} satisfies ExportedHandler<
  CloudflareEnv &
    OperationsEnvironment & { FORM_JOB_TOKEN?: string; CRM_JOB_QUEUE?: Queue<CRMJobWake>; STRIPE_TEST_WEBHOOK_SECRET?: string }
>
