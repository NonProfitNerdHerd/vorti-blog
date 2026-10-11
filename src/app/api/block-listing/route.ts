import { getPayload } from 'payload'
import config from '@/payload.config'
import { queryBlockListing } from '@/lib/block-listings'
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const payload = await getPayload({ config })
  const draft = params.get('draft') === 'true'
  const user = draft ? (await payload.auth({ headers: request.headers })).user : undefined
  if (draft && !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await queryBlockListing(
    payload,
    Object.fromEntries(params),
    Number(params.get('page')) || 1,
    { draft, user },
  )
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
