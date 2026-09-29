import { headers } from 'next/headers'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { resolveContentDesign } from '@/lib/post-design'
import type { Page, Post } from '@/payload-types'

export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await headers() })
  if (!user || user.collection !== 'users') return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let data: Page | Post
  try { data = await request.json() as Page | Post }
  catch { return Response.json({ error: 'Invalid content' }, { status: 400 }) }
  if (!data || typeof data !== 'object') return Response.json({ error: 'Invalid content' }, { status: 400 })
  try { return Response.json(await resolveContentDesign(data)) }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unable to resolve Template' }, { status: 422 }) }
}
