import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSiteSettings } from '@/lib/frontend'
import { postsPath } from '@/lib/site-pages'
import { PostsListing } from '@/components/PostsListing'
export const dynamic = 'force-dynamic'
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteSettings()
  return { title: `Posts | ${site.siteName || 'VortiCause'}`, description: site.defaultSeoDescription || site.siteDescription || undefined }
}
export default async function PostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [site, query] = await Promise.all([getSiteSettings(), searchParams])
  const path = postsPath(site)
  if (path !== '/posts') {
    const params = new URLSearchParams()
    Object.entries(query).forEach(([k, v]) => { if (Array.isArray(v)) v.forEach(item => params.append(k, item)); else if (v != null) params.set(k, v) })
    redirect(path + (params.size ? '?' + params.toString() : ''))
  }
  return <PostsListing rawPage={typeof query.page === 'string' ? query.page : undefined} />
}
