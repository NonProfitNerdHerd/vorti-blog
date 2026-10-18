import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PostCard } from './PostCard'
import { getPublishedPosts } from '@/lib/frontend'

export async function PostsListing({
  rawPage,
  path = '/posts',
  title = 'Posts',
}: {
  rawPage?: string
  path?: string
  title?: string
}) {
  const page = Number(rawPage || 1)
  if (!Number.isSafeInteger(page) || page < 1) notFound()
  const posts = await getPublishedPosts(page, 10)
  return (
    <div className="container">
      <h1>{title}</h1>
      {posts.docs.length ? (
        posts.docs.map((post) => <PostCard key={post.id} post={post} />)
      ) : (
        <p>No posts found.</p>
      )}
      <nav aria-label="Posts pagination" className="pagination">
        {posts.hasPrevPage && (
          <Link href={page === 2 ? path : `${path}?page=${page - 1}`}>Previous</Link>
        )}
        <span>
          Page {page} of {Math.max(1, posts.totalPages)}
        </span>
        {posts.hasNextPage && <Link href={`${path}?page=${page + 1}`}>Next</Link>}
      </nav>
    </div>
  )
}
