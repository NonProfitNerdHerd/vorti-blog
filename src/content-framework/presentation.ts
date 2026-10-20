import type { Payload } from 'payload'
import { publicAuthors } from '../lib/public-attribution'
/** Public attribution is resolved from the author relationship. */
export async function withPostAuthor<T extends Record<string, unknown>>(
  payload: Payload,
  post: T,
): Promise<T> {
  if (typeof post.author === 'number') {
    const author = (await publicAuthors(payload, [post.author])).get(post.author)
    post = { ...post, author: author || post.author }
  }
  return post
}
