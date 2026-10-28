import { APIError, type Config, type PayloadRequest } from 'payload'
import { KnowledgeRepository } from './repository'
import type { KnowledgeKind } from './content'
import { readBoundedJSON } from '../forms/security'
import { errorResponse } from '../crm/plugin'
import { claimRequest } from '../organizations/identity-authority'
import { AUTHORITY_MUTATION_COMMITTED } from '../organizations/authority-plugin'
import { readLegacyIntranet, retiredIntranetWrite } from '../publishing/legacy-api'
import { publishingRequestSite } from '../publishing/request-site'

export const knowledgeModule =
  (db: D1Database, storage: R2Bucket) =>
  (config: Config): Config => {
    const scope = async (req: PayloadRequest) => {
      const url = new URL(req.url!),
        site = publishingRequestSite(req.url!, req.headers),
        kind = url.searchParams.get('kind') as KnowledgeKind
      if (!['wiki', 'intranet'].includes(kind)) throw new APIError('Choose Wiki or Intranet.', 400)
      if (req.user) await claimRequest(req, site)
      return {
        url,
        site,
        kind,
        repo: new KnowledgeRepository(db, req.user ? Number(req.user.id) : null),
      }
    }
    return {
      ...config,
      endpoints: [
        ...(config.endpoints || []),
        {
          path: '/knowledge',
          method: 'get',
          handler: async (req) => {
            try {
              const { url, site, kind, repo } = await scope(req),
                id = url.searchParams.get('id') || ''
              if (kind === 'intranet') return await readLegacyIntranet(req, site, storage)
              if (url.searchParams.has('file')) {
                const file = await repo.attachment(
                  site,
                  kind,
                  id,
                  url.searchParams.get('file')!,
                  storage,
                  url.searchParams.get('draft') === '1',
                )
                return new Response(file.object.body, {
                  headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': `attachment; filename="${file.filename}"`,
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'Content-Security-Policy': "default-src 'none'; sandbox",
                  },
                })
              }
              const result = id
                ? url.searchParams.has('versions')
                  ? { versions: await repo.versions(site, kind, id) }
                  : { doc: await repo.get(site, kind, id, url.searchParams.get('draft') === '1') }
                : await repo.list(site, kind, {
                    search: url.searchParams.get('search') || '',
                    after: url.searchParams.get('after') || '',
                    history: url.searchParams.get('draft') === '1',
                  })
              return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
            } catch (error) {
              return errorResponse(error)
            }
          },
        },
        {
          path: '/knowledge',
          method: 'post',
          handler: async (req) => {
            try {
              if (!req.user) throw new APIError('Sign in to edit content.', 401)
              if (req.headers.get('origin') !== new URL(req.url!).origin)
                throw new APIError('Use the signed-in site to edit content.', 403)
              const { site, kind, repo } = await scope(req)
              if (kind === 'intranet') return await retiredIntranetWrite(req, site)
              const body = await readBoundedJSON(req, 330000)
              const result = await repo.save({ ...body, site, kind } as Parameters<
                KnowledgeRepository['save']
              >[0])
              ;(req.context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED] = true
              return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
            } catch (error) {
              return errorResponse(error)
            }
          },
        },
        {
          path: '/knowledge/attachments',
          method: 'post',
          handler: async (req) => {
            try {
              if (!req.user || req.headers.get('origin') !== new URL(req.url!).origin)
                throw new APIError('Sign in to upload attachments.', 403)
              const { url, site, kind, repo } = await scope(req)
              if (kind === 'intranet') return await retiredIntranetWrite(req, site)
              const size = Number(req.headers.get('content-length'))
              if (!Number.isSafeInteger(size) || size < 1 || size > 11 * 1024 * 1024)
                throw new APIError('Choose a file up to 10 MB.', 413)
              const form = await req.formData!(),
                file = form.get('file')
              if (!(file instanceof File)) throw new APIError('Choose an attachment.', 400)
              const result = await repo.upload(
                site,
                kind,
                url.searchParams.get('id') || '',
                file,
                storage,
              )
              ;(req.context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED] = true
              return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
            } catch (error) {
              return errorResponse(error)
            }
          },
        },
      ],
    }
  }
