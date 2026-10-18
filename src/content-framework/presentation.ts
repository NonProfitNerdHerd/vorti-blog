import type { Payload } from 'payload'
import { publishedType, refID } from './collections'
import { publicAuthors } from '../lib/public-attribution'
/** Presentation inherits the published type default without storing it on the Post. */
export async function withPostType<T extends Record<string, unknown>>(
  payload: Payload,
  post: T,
): Promise<T> {
  if (typeof post.author === 'number') {
    const author = (await publicAuthors(payload, [post.author])).get(post.author)
    post = { ...post, author: author || post.author }
  }
  const type = await publishedType(payload, post.postType)
  if (!type) return post
  return {
    ...post,
    postType: type,
    designTemplate: post.designTemplate || refID(type.defaultTemplate) || null,
  }
}
