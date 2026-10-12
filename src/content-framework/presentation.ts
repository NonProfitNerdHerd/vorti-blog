import type { Payload } from 'payload'
import { publishedType, refID } from './collections'
/** Presentation inherits the published type default without storing it on the Post. */
export async function withPostType<T extends Record<string, unknown>>(
  payload: Payload,
  post: T,
): Promise<T> {
  const type = await publishedType(payload, post.postType)
  if (!type) return post
  return {
    ...post,
    postType: type,
    designTemplate: post.designTemplate || refID(type.defaultTemplate) || null,
  }
}
