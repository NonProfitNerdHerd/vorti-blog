import { APIError, createLocalReq, type Config } from 'payload'
import { cmsDatabase, cmsSiteContext } from '../organizations/cms-scope'
import { claimRequest } from '../organizations/identity-authority'
import { CMS_AUDIENCE, type Audience } from './readership'
import { assertPublishingPipeline, pinPublishingPipeline, publishingPipelineAllowed } from './pipeline-scope'
import { saveExportManifest } from './export-manifest'

/** Retained queued jobs execute as the stored file owner in its stored scope.
 * An old job without verifiable provenance stays blocked for reconciliation;
 * it never borrows the scheduler's administrator identity or selected site.
 */
export function publishingPipelineJobs(config: Config): Config['jobs'] {
  return { ...config.jobs, tasks: config.jobs?.tasks?.map(task => {
    if (!['createCollectionExport', 'createCollectionImport'].includes(task.slug) || typeof task.handler !== 'function') return task
    const handler = task.handler
    return { ...task, handler: async (args: Parameters<typeof handler>[0]) => {
      const input = args.input as Record<string, unknown>, exporting = task.slug === 'createCollectionExport'
      const collection = exporting ? 'exports' : 'imports', id = Number(exporting ? input?.id : input?.importId)
      if (!Number.isSafeInteger(id) || id < 1 || input[exporting ? 'exportCollection' : 'importCollection'] !== collection)
        throw new APIError('Queued publishing target requires reconciliation.', 409)
      const db = cmsDatabase(args.req)
      const stored = await db.prepare(`SELECT platform_site,audience,publishing_owner,collection_slug FROM "${collection}" WHERE id=?`).bind(id)
        .first<{ platform_site: string; audience: Audience; publishing_owner: number; collection_slug: string }>()
      if (!stored?.publishing_owner || !['public', 'intranet'].includes(stored.audience) || !['posts', 'pages'].includes(stored.collection_slug) ||
        input.userCollection && input.userCollection !== 'users' || input.userID && Number(input.userID) !== stored.publishing_owner ||
        exporting && input.collectionSlug !== stored.collection_slug)
        throw new APIError('Queued publishing owner or scope requires reconciliation. The job remains retained.', 409)
      const user = await args.req.payload.findByID({ collection: 'users', id: stored.publishing_owner, depth: 0, overrideAccess: true })
      const req = await createLocalReq({ user: { ...user, collection: 'users' }, context: { ...cmsSiteContext(stored.platform_site), [CMS_AUDIENCE]: stored.audience } }, args.req.payload)
      const claim = await claimRequest(req, stored.platform_site)
      if (!claim || !publishingPipelineAllowed(req, claim.permissions || [], exporting ? 'export' : 'import', stored.collection_slug, input.drafts === 'yes'))
        throw new APIError('Publishing job blocked because its owner’s current permission is unavailable.', 403)
      pinPublishingPipeline(req, stored.platform_site, stored.audience)
      await req.payload.findByID({ collection, id, req, depth: 0, overrideAccess: false })
      if (exporting && await db.prepare('SELECT 1 FROM vc_publishing_export_manifests WHERE export_id=? AND ready=1').bind(id).first()) return { output: {} }
      const result = await handler({ ...args, req, input: { ...input, userID: String(user.id), userCollection: 'users' } } as Parameters<typeof handler>[0])
      assertPublishingPipeline(req)
      if (exporting) await saveExportManifest(req, id)
      return result
    } }
  }) }
}
