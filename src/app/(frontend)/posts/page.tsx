import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PostCard } from '@/components/PostCard'
import { getPublishedPosts, getSiteSettings } from '@/lib/frontend'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteSettings()
  return { title: `Posts | ${site.siteName || 'Vorti Blog'}`, description: site.defaultSeoDescription || site.siteDescription || undefined }
}

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: rawPage } = await searchParams
  const page = Number(rawPage || 1)
  if (!Number.isSafeInteger(page) || page < 1) notFound()
  const posts = await getPublishedPosts(page, 10)
  return (
    <div className="container">
      <h1>Posts</h1>
      {posts.docs.length ? posts.docs.map((post) => <PostCard key={post.id} post={post} />) : <p>No posts found.</p>}
      <nav aria-label="Posts pagination" className="pagination">
        {posts.hasPrevPage && <Link href={page === 2 ? '/posts' : `/posts?page=${page - 1}`}>Previous</Link>}
        <span>Page {page} of {posts.totalPages}</span>
        {posts.hasNextPage && <Link href={`/posts?page=${page + 1}`}>Next</Link>}
      </nav>
    </div>
  )
}
