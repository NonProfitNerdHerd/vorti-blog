import type { Config, Endpoint, PayloadRequest } from 'payload'
import { claimRequest } from '../organizations/identity-authority'
import { authorityClaim } from '../organizations/claims'
import { cmsSiteContext } from '../organizations/cms-scope'
import { readBoundedJSON, constantEqual } from '../forms/security'
import { AutomationStore, type AutomationRow, type RunRow } from './store'
import { AUTOMATION_WRITE, AutomationRunner, payloadAdapter } from './runtime'
import { resources, registry, type Resource } from './model'
import type { Permission } from '../organizations/permission-catalog'

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
export function automationsModule(db: D1Database) {
  return (config: Config): Config => {
    const store = new AutomationStore(db)
    async function scope(req: PayloadRequest) {
      if (!req.user || req.user.collection !== 'users') throw Error('Sign in to use automations.')
      const url = new URL(req.url!),
        site = url.searchParams.get('site') || 'default'
      Object.assign(req.context, cmsSiteContext(site))
      const claim = await claimRequest(req, site)
      if (claim?.permissions && !claim.permissions.includes('workflows:read'))
        throw Error('Workflow unavailable.')
      if (
        !claim ||
        (!claim.bootstrap &&
          !claim.operator &&
          !Object.values(claim.allowed).some((v) => v?.length))
      )
        throw Error('Site unavailable.')
      return { site, owner: Number(req.user.id), url }
    }
    const endpoint = (method: 'get' | 'post'): Endpoint => ({
      path: '/automations',
      method,
      handler: async (req) => {
        try {
          const { site, owner, url } = await scope(req),
            adapter = payloadAdapter(req.payload, db),
            runner = new AutomationRunner(store, adapter)
          if (method === 'get') {
            if (url.searchParams.has('shared'))
              return json({
                template: await store.sharedTemplate(site, url.searchParams.get('shared')!),
              })
            if (url.searchParams.get('view') === 'shared')
              return json({ docs: await store.shared(site, url.searchParams.get('search') || '') })
            if (url.searchParams.has('registry'))
              return json({
                registry,
                resources,
                warning:
                  'Blocks run with your current resource permissions. Tests perform real writes. Diagnostics recheck record and field permissions and mask secret fields.',
              })
            if (url.searchParams.has('run'))
              return json({
                run: await runner.diagnostics(
                  (await store.view(site, owner, { run: url.searchParams.get('run')! })) as RunRow,
                  owner,
                ),
              })
            const id = url.searchParams.get('id')
            if (id) {
              const doc = (await store.view(site, owner, { id })) as AutomationRow
              const claim = authorityClaim(req.user)
              return json({
                doc,
                runs:
                  !claim?.permissions || claim.permissions.includes('workflows:diagnostics')
                    ? await store.runs(doc)
                    : [],
              })
            }
            return json({
              docs: await store.view(site, owner, { search: url.searchParams.get('search') || '' }),
            })
          }
          if (req.headers.get('origin') !== url.origin)
            return json({ message: 'A same-origin request is required.' }, 403)
          const body = await readBoundedJSON(req, 80000)
          const claim = authorityClaim(req.user)
          if (claim?.permissions) {
            const permission: Permission =
              body.action === 'transfer' ? 'workflows:edit' : body.action === 'save'
                ? body.id
                  ? 'workflows:edit'
                  : 'workflows:create'
                : body.action === 'cancel'
                  ? 'workflows:cancel'
                  : body.action === 'share' || body.action === 'unshare'
                    ? 'workflows:share-templates'
                    : body.action === 'publish' || body.action === 'pause'
                      ? 'workflows:publish'
                      : 'workflows:execute'
            if (!claim.permissions.includes(permission)) throw Error('Workflow unavailable.')
          }
          if (body.action === 'save')
            return json({ doc: await store.save(site, owner, body as never) })
          if (body.action === 'cancel') {
            await store.cancel(site, owner, String(body.run))
            return json({ ok: true })
          }
          const doc = await store.get(site, owner, String(body.id))
          if (body.action === 'transfer') {
            if (body.confirmPause !== true || typeof body.email !== 'string') throw Error('Confirm that the workflow will pause before transfer.')
            return json(await store.transfer(doc, body.email))
          }
          if (body.action === 'share' || body.action === 'unshare')
            return json({ doc: await store.share(doc, body.action === 'share') })
          if (body.action === 'publish' || body.action === 'pause')
            return json({ doc: await store.control(doc, body.action) })
          if (body.action === 'test' || body.action === 'run') {
            if (body.confirmWrites !== true)
              throw Error('Confirm that this test performs real writes.')
            const definition = JSON.parse(
              body.action === 'test' ? doc.draft : doc.published || '{}',
            )
            if (body.action === 'run' && (!doc.active || definition.trigger?.kind !== 'manual'))
              throw Error('Publish an active manual workflow before running it.')
            let event: Parameters<typeof store.enqueue>[2]
            if (definition.trigger.kind !== 'manual') {
              const id = String(body.recordID || definition.trigger.recordID || '')
              await adapter.read(site, owner, {
                resource: definition.trigger.resource as Resource,
                id,
              })
              event = {
                id: crypto.randomUUID(),
                site,
                resource: definition.trigger.resource,
                record_id: id,
                kind: definition.trigger.kind,
                fields: '[]',
                created_at: new Date().toISOString(),
              }
            } else
              event = {
                id: crypto.randomUUID(),
                input:
                  body.input && typeof body.input === 'object' && !Array.isArray(body.input)
                    ? (body.input as Record<string, unknown>)
                    : {},
              }
            const run = await store.enqueue(
              doc,
              body.action === 'test' ? 'test' : 'live',
              event,
              body.action === 'test',
            )
            // Test requests execute a bounded run now; queued runs remain durable if interrupted.
            await runner.tick(1, run)
            return json({ run: await runner.diagnostics(await store.run(site, owner, run)) })
          }
          throw Error('Choose a supported automation action.')
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          const safe =
            /^(Choose|Each block|Map fields|Enter|Use at most|Add at least|This draft|Confirm that|Publish|Form submissions|Sign in|Automation unavailable|Workflow unavailable|Run unavailable|Site unavailable|A mapped|The workflow|Invalid field)/.test(
              message,
            )
          return json(
            {
              message: safe
                ? message
                : 'The operation could not complete. Check permissions, mapped fields, and database migrations.',
            },
            safe && /unavailable|Sign in/.test(message) ? 403 : 400,
          )
        }
      },
    })
    const tick: Endpoint = {
      path: '/automations/tick',
      method: 'post',
      handler: async (req) => {
        const secret = process.env.FORM_JOB_TOKEN
        if (
          !secret ||
          secret.length < 32 ||
          !constantEqual(req.headers.get('authorization') || '', `Bearer ${secret}`)
        )
          return json({ message: 'Job authentication is required.' }, 403)
        const dispatched = await store.dispatch()
        const processed = await new AutomationRunner(store, payloadAdapter(req.payload, db)).tick()
        return json({ dispatched, processed })
      },
    }
    return {
      ...config,
      endpoints: [...(config.endpoints || []), endpoint('get'), endpoint('post'), tick],
      admin: {
        ...config.admin,
        components: {
          ...config.admin?.components,
          views: {
            ...config.admin?.components?.views,
            automations: {
              path: '/automations',
              Component: './automations/AdminView#AutomationsAdminView',
            },
            workflows: {
              path: '/workflows',
              Component: './automations/AdminView#AutomationsAdminView',
            },
          },
        },
      },
      collections: (config.collections || []).map((collection) => {
        if (!['review-tasks', 'pages', 'posts'].includes(collection.slug)) return collection
        return {
          ...collection,
          fields: [
            ...collection.fields,
            {
              name: 'automationOrigin',
              type: 'text',
              admin: { hidden: true },
              access: { read: () => false, create: () => false, update: () => false },
            },
            ...(collection.slug === 'review-tasks'
              ? [
                  {
                    name: 'automationSite',
                    type: 'text' as const,
                    admin: { hidden: true },
                    access: { read: () => false, create: () => false, update: () => false },
                  },
                ]
              : []),
          ],
          hooks: {
            ...collection.hooks,
            beforeChange: [
              ...(collection.hooks?.beforeChange || []),
              ({ data, req }) => {
                data.automationOrigin =
                  (req.context as Record<symbol, unknown>)[AUTOMATION_WRITE] || null
                if (collection.slug === 'review-tasks')
                  data.automationSite = authorityClaim(req.user)?.site || 'default'
                return data
              },
            ],
          },
        }
      }),
    }
  }
}
