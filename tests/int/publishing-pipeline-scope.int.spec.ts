import { expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { assertPublishingPipeline, pinPublishingPipeline, publishingPipelineAllowed } from '@/publishing/pipeline-scope'
import { CMS_AUDIENCE, CMS_PUBLIC_RENDER } from '@/publishing/readership'
import { cmsSiteContext } from '@/organizations/cms-scope'

it('retains database failures even if an upstream exporter catches a failed count', async () => {
  const failure = Error('Database unavailable')
  const req = { user: { id: 3 }, payload: { count: vi.fn(async () => { throw failure }) }, context: {}, headers: new Headers() } as unknown as PayloadRequest
  pinPublishingPipeline(req, 'default', 'public')
  await expect(req.payload.count({ collection: 'posts' })).rejects.toBe(failure)
  expect(() => assertPublishingPipeline(req)).toThrow(failure)
})

it('pins plugin Local API calls that omitted the original request to its actor, site and audience', async () => {
  const find = vi.fn(async (options: unknown) => options), count = vi.fn(async (options: unknown) => options)
  const req = { user: { id: 3, collection: 'users' }, payload: { find, count }, context: {}, headers: new Headers(), url: 'https://example.invalid/api/exports' } as unknown as PayloadRequest
  pinPublishingPipeline(req, 'child', 'intranet')
  await req.payload.find({ collection: 'posts', user: { id: 3 } as never })
  const options = find.mock.calls[0][0] as { req: PayloadRequest; overrideAccess: boolean; user: { id: number } }
  expect(options.user.id).toBe(3)
  expect(options.overrideAccess).toBe(false)
  expect(options.req.context).toMatchObject(cmsSiteContext('child'))
  expect((options.req.context as Record<symbol, unknown>)[CMS_AUDIENCE]).toBe('intranet')
  await expect(req.payload.find({ collection: 'posts', user: { id: 4 } as never })).rejects.toMatchObject({ status: 403 })
  expect(() => pinPublishingPipeline(req, 'default', 'public')).toThrow('scope changed')
})
it('locks public export relationship expansion to public content and rejects imported audience switches', async () => {
  const find = vi.fn(async (options: unknown) => options), create = vi.fn(async (options: unknown) => options)
  const req = { user: { id: 3, collection: 'users' }, payload: { find, create }, context: {}, headers: new Headers(), url: 'https://example.invalid/api/exports' } as unknown as PayloadRequest
  pinPublishingPipeline(req, 'default', 'public')
  await req.payload.find({ collection: 'posts' })
  const options = find.mock.calls[0][0] as { req: PayloadRequest }
  expect((options.req.context as Record<symbol, unknown>)[CMS_PUBLIC_RENDER]).toBe(true)
  await expect(req.payload.create({ collection: 'pages', draft: true, data: { title: 'Wrong area', audience: 'intranet' } })).rejects.toMatchObject({ status: 409 })
  expect(create).not.toHaveBeenCalled()
})
it('uses internal authoring/history permissions independently of public Posts and Pages grants', () => {
  const req = { context: { [CMS_AUDIENCE]: 'intranet' } } as unknown as PayloadRequest
  expect(publishingPipelineAllowed(req, ['intranet:read', 'intranet:read-history'], 'export', 'posts')).toBe(true)
  expect(publishingPipelineAllowed(req, ['intranet:read', 'intranet:read-history', 'intranet:create'], 'import', 'pages')).toBe(false)
  expect(publishingPipelineAllowed(req, ['intranet:read', 'intranet:read-history', 'intranet:create', 'intranet:edit'], 'import', 'pages')).toBe(true)
  expect(publishingPipelineAllowed({ context: {} } as PayloadRequest, ['intranet:read-history'], 'export', 'posts')).toBe(false)
})
