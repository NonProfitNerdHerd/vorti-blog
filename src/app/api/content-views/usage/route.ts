import { getPayload } from 'payload'
import config from '@/payload.config'
import { viewUsages } from '@/content-framework/collections'
export async function GET(request: Request) {
  const payload = await getPayload({ config }),
    { user } = await payload.auth({ headers: request.headers })
  if (!user || !['administrator', 'designer'].includes(user.role || ''))
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  const { createLocalReq } = await import('payload')
  const req = await createLocalReq({ user }, payload)
  return Response.json(
    { usages: await viewUsages(payload, new URL(request.url).searchParams.get('id') || '', req) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
