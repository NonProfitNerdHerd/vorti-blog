import Link from 'next/link'
import { PostCard } from '@/components/PostCard'
import { getPublishedPosts, getSiteSettings } from '@/lib/frontend'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [site, recent] = await Promise.all([getSiteSettings(), getPublishedPosts(1, 5)])
  return (
    <div className="container">
      <section className="intro">
        <h1>{site.siteName || 'Vorti Blog'}</h1>
        {site.siteTagline && <p>{site.siteTagline}</p>}
        {site.siteDescription && <p>{site.siteDescription}</p>}
        <Link className="button" href="/posts">Explore all posts</Link>
      </section>
      <section aria-labelledby="recent-title">
        <h2 id="recent-title">Recent posts</h2>
        {recent.docs.length ? recent.docs.map((post) => <PostCard key={post.id} post={post} />) : <p>No posts have been published yet.</p>}
      </section>
    </div>
  )
}
