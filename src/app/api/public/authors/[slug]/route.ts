import { getPublicAuthorProfile } from '@/lib/publicContent'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const profile = await getPublicAuthorProfile(slug)
  if (!profile) return Response.json({ error: 'Author not found' }, { status: 404 })
  return Response.json(profile)
}
