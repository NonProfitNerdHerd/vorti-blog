import type { CollectionBeforeChangeHook } from 'payload'
/** Record the first intentional publication, never substitute an unrelated edit time. */
export const publicationTimestamp: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  if (
    data._status === 'published' &&
    originalDoc?._status !== 'published' &&
    !data.publishedAt &&
    !originalDoc?.publishedAt
  )
    data.publishedAt = new Date().toISOString()
  return data
}
