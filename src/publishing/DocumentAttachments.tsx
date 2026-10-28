import type { internalContext } from './internal-context'

/** The migration mapping is deliberately not used for delivery or filenames.
 * Native media queries re-evaluate the document, ancestry and current sharing.
 */
export async function DocumentAttachments({ selected, collection, id }: { selected: Awaited<ReturnType<typeof internalContext>>; collection: 'posts' | 'pages'; id: number }) {
  const result = await selected.payload.find({ collection: 'media', req: await selected.req(), depth: 0, overrideAccess: false, limit: 20,
    where: { and: [{ publishingSourceCollection: { equals: collection } }, { publishingSourceID: { equals: id } }] }, sort: 'filename' })
  await selected.assertCurrent()
  if (!result.docs.length) return null
  return <section className="container" aria-label="Document attachments"><h2>Attachments</h2><ul>{result.docs.map(media => <li key={media.id}>
    <a href={`${selected.prefix}/api/publishing/media/${media.id}?site=${encodeURIComponent(selected.site)}`}>{media.publishingOriginalFilename || media.filename || media.alt || 'Download file'}</a>
  </li>)}</ul>{result.hasNextPage && <p>More files are available in the <a href={`${selected.prefix}/intranet/resources`}>resource directory</a>.</p>}</section>
}
