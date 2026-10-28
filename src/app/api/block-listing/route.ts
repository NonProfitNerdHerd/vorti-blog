import { getPayload } from 'payload'
import config from '@/payload.config'
import { queryBlockListing } from '@/lib/block-listings'
import { publishingRequestScope } from '@/publishing/request-scope'
import { errorResponse } from '@/crm/plugin'
export async function GET(request: Request) {
  try {
  const params = new URL(request.url).searchParams
  const payload = await getPayload({ config })
  const draft = params.get('draft') === 'true'
  const scope = await publishingRequestScope(payload, request, draft)
  const result = await queryBlockListing(
    payload,
    Object.fromEntries(params),
    Number(params.get('page')) || 1,
    scope,
  )
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
