import { getPayload } from 'payload'
import config from '@/payload.config'
import { queryView, readSavedView } from '@/content-framework/query'
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams,
      payload = await getPayload({ config })
    const draft = params.get('draft') === 'true',
      user = draft ? (await payload.auth({ headers: request.headers })).user : undefined
    if (draft && !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const id = params.get('view')
    if (!id) return Response.json({ error: 'Choose a Saved View' }, { status: 400 })
    const view = await readSavedView(payload, id, { user, draft })
    return Response.json(await queryView(payload, view, params, { user, draft }), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to load view' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
export async function POST(request: Request) {
  const payload = await getPayload({ config }),
    { user } = await payload.auth({ headers: request.headers })
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = (await request.json()) as {
      configuration: import('@design-system/payload-design-core').ViewConfig
      params?: Record<string, string>
    }
    return Response.json(
      await queryView(payload, body.configuration, new URLSearchParams(body.params || {}), {
        user,
        draft: true,
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid preview' },
      { status: 400 },
    )
  }
}
