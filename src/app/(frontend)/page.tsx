import { publicPath } from '@/lib/public-site-context'
import { SiteAnchor as Link } from '@design-system/payload-design-core/content'
import { PostCard } from '@/components/PostCard'
import { getPublishedPosts, getSiteSettings } from '@/lib/frontend'

import { homePage, postsPath } from '@/lib/site-pages'
import { PageArticle } from '@/components/PageArticle'
import { resolvePageDesign } from '@/lib/post-design'
import { contentMetadata } from '@/lib/frontend'

export async function generateMetadata() { const site = await getSiteSettings(); const page = homePage(site); return page ? { ...contentMetadata(page, site), alternates: { canonical: await publicPath('/') } } : {alternates:{canonical: await publicPath('/')}} }

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [site, recent] = await Promise.all([getSiteSettings(), getPublishedPosts(1, 5)])
  const page = homePage(site)
  if (page) return <PageArticle page={page} designSections={await resolvePageDesign(page)} />
  return (
    <div className="container">
      <section className="intro">
        <h1>{site.siteName || 'VortiCause'}</h1>
        {site.siteTagline && <p>{site.siteTagline}</p>}
        {site.siteDescription && <p>{site.siteDescription}</p>}
        <Link className="button" href={await publicPath(postsPath(site))}>Explore all posts</Link>
      </section>
      <section aria-labelledby="recent-title">
        <h2 id="recent-title">Recent posts</h2>
        {recent.docs.length ? recent.docs.map((post) => <PostCard key={post.id} post={post} />) : <p>No posts have been published yet.</p>}
      </section>
    </div>
  )
}
