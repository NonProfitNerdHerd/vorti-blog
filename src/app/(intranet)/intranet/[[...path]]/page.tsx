import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { internalContext, internalPagePath } from '@/publishing/internal-context'
import { PageArticle } from '@/components/PageArticle'
import { PostArticle } from '@/components/PostArticle'
import { LivePagePreview } from '@/components/LivePagePreview'
import { LivePostPreview } from '@/components/LivePostPreview'
import { resolveContentDesign } from '@/lib/post-design'
import { TenantRepository } from '@/organizations/tenant-repository'
import { DocumentAttachments } from '@/publishing/DocumentAttachments'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Intranet', robots: { index: false, follow: false } }
type Props = { params: Promise<{ path?: string[] }>; searchParams: Promise<{ q?: string; livePreview?: string; newsPage?: string; resourcesPage?: string; filesPage?: string }> }

export default async function IntranetPage({ params, searchParams }: Props) {
  const { path = [] } = await params, query = await searchParams
  const selected = await internalContext(), { payload, prefix, site, user } = selected
  const render = { site, user, audience: 'intranet' as const }
  const base = prefix + '/intranet'
  if (query.livePreview) {
    const collection = path[0] === 'posts' ? 'posts' : 'pages'
    await new TenantRepository(selected.db, Number(user.id)).require(site, 'intranet:read-history')
    const id = Number(query.livePreview)
    if (!Number.isSafeInteger(id) || id < 1) notFound()
    const document = await payload.findByID({ collection, id, req: await selected.req(), draft: true, depth: 2, overrideAccess: false })
    if (document.audience !== 'intranet') notFound()
    const sections = await resolveContentDesign(document, { ...render, draft: true })
    await selected.assertCurrent()
    return collection === 'posts' ? <LivePostPreview initialData={document as import('@/payload-types').Post} initialDesignSections={sections} /> : <LivePagePreview initialData={document as import('@/payload-types').Page} initialDesignSections={sections} />
  }
  if (path[0] === 'posts' && path.length === 2) {
    const result = await payload.find({ collection: 'posts', req: await selected.req(), where: { and: [{ slug: { equals: path[1] } }, { _status: { equals: 'published' } }] }, depth: 2, limit: 1, overrideAccess: false })
    const post = result.docs[0]
    if (!post) notFound()
    const sections = await resolveContentDesign(post, render)
    await selected.assertCurrent()
    return <><PostArticle post={post} designSections={sections} /><DocumentAttachments selected={selected} collection="posts" id={post.id} /></>
  }
  if (path[0] === 'pages' && path.length > 1) {
    const result = await payload.find({ collection: 'pages', req: await selected.req(), where: { and: [{ slug: { equals: path.at(-1) } }, { _status: { equals: 'published' } }] }, depth: 1, limit: 1, overrideAccess: false })
    const page = result.docs[0]
    if (!page || internalPagePath(page).replace(/^\//, '') !== path.slice(1).map(encodeURIComponent).join('/')) notFound()
    const sections = await resolveContentDesign(page, render)
    await selected.assertCurrent()
    return <><PageArticle page={page} designSections={sections} /><DocumentAttachments selected={selected} collection="pages" id={page.id} /></>
  }
  if (path.length >= 1 && path.length <= 2 && !['posts', 'pages', 'resources'].includes(path[0])) {
    const mapping = await selected.db.prepare(`SELECT m.page_id FROM vc_publishing_legacy_map m JOIN vc_knowledge_pages p ON p.id=m.legacy_id WHERE m.legacy_id=? AND p.site_id=? AND p.kind='intranet'`).bind(path[0], site).first<{ page_id: number }>()
    if (!mapping) notFound()
    const page = await payload.findByID({ collection: 'pages', id: mapping.page_id, req: await selected.req(), overrideAccess: false, depth: 0 })
    if (page._status !== 'published' || page.publishingLineage !== `legacy:${path[0]}`) notFound()
    await selected.assertCurrent()
    redirect(page.audience === 'intranet' ? base + '/pages' + internalPagePath(page) : prefix + internalPagePath(page))
  }
  if (path.length > 1) notFound()
  if (!path.length && selected.settings.intranetHomepage) {
    const page = await payload.findByID({ collection: 'pages', id: Number(selected.settings.intranetHomepage), req: await selected.req(), overrideAccess: false, depth: 1 })
    if (page._status !== 'published' || page.audience !== 'intranet') notFound()
    const sections = await resolveContentDesign(page, render)
    await selected.assertCurrent()
    if (!query.q) return <><PageArticle page={page} designSections={sections} /><DocumentAttachments selected={selected} collection="pages" id={page.id} /></>
  }
  return <Portal selected={selected} base={base} query={query} search={query.q || ''} mode={path[0] === 'posts' ? 'posts' : path[0] === 'resources' ? 'resources' : 'home'} />
}

async function Portal({ selected, base, search, mode, query }: { selected: Awaited<ReturnType<typeof internalContext>>; base: string; search: string; mode: 'home' | 'posts' | 'resources'; query: Awaited<Props['searchParams']> }) {
  const term = search.trim().slice(0, 200)
  const pageNumber = (value?: string) => value && /^\d{1,4}$/.test(value) && Number(value) > 0 ? Number(value) : 1
  const where = { and: [{ _status: { equals: 'published' as const } }, ...(term ? [{ title: { like: term } }] : [])] }
  const [posts, pages, files] = await Promise.all([
    mode === 'resources' ? null : selected.payload.find({ collection: 'posts', req: await selected.req(), where, depth: 1, limit: 20, page: pageNumber(query.newsPage), sort: '-publishedAt', overrideAccess: false }),
    mode === 'posts' ? null : selected.payload.find({ collection: 'pages', req: await selected.req(), where: { and: [where, { id: { not_equals: Number(selected.settings.intranetHomepage) || 0 } }] }, depth: 0, limit: 20, page: pageNumber(query.resourcesPage), sort: 'title', overrideAccess: false }),
    mode === 'posts' ? null : selected.payload.find({ collection: 'media', req: await selected.req(), ...(term ? { where: { or: [{ alt: { like: term } }, { filename: { like: term } }, { publishingOriginalFilename: { like: term } }] } } : {}), depth: 0, limit: 20, page: pageNumber(query.filesPage), sort: 'filename', overrideAccess: false }),
  ])
  await selected.assertCurrent()
  const pagination = (result: { page?: number; hasPrevPage: boolean; hasNextPage: boolean }, key: 'newsPage' | 'resourcesPage' | 'filesPage', label: string) => {
    const href = (page: number) => {
      const next = new URLSearchParams()
      if (term) next.set('q', term)
      for (const name of ['newsPage', 'resourcesPage', 'filesPage'] as const) if (query[name]) next.set(name, String(pageNumber(query[name])))
      next.set(key, String(page))
      return `${base}${mode === 'home' ? '' : `/${mode}`}?${next}`
    }
    return (result.hasPrevPage || result.hasNextPage) && <nav aria-label={label} style={{ display: 'flex', gap: '1rem' }}>{result.hasPrevPage && <Link href={href((result.page || 1) - 1)}>Previous</Link>}{result.hasNextPage && <Link href={href((result.page || 1) + 1)}>Next</Link>}</nav>
  }
  return <section className="intranet-portal container">
    <header className="intranet-portal__welcome"><p className="intranet-eyebrow">{selected.siteName} · Internal</p><h1>{mode === 'posts' ? 'News' : mode === 'resources' ? 'Resources' : 'Your Intranet'}</h1>
      <p>News, shared knowledge, and the resources available to you.</p>
      <form action={base} role="search"><label htmlFor="intranet-search">Search internal content</label><div><input id="intranet-search" name="q" type="search" defaultValue={term} maxLength={200} /><button type="submit">Search</button></div></form>
    </header>
    <nav className="intranet-quick-links" aria-label="Intranet quick links"><Link href={base + '/posts'}>News</Link><Link href={base + '/resources'}>Resources</Link></nav>
    {posts && <section aria-label="Internal news"><h2>Latest news</h2><div className="intranet-news-grid">{posts.docs.map(post => <article className="intranet-news-card" key={post.id}><p className="intranet-eyebrow">News</p><h3><Link href={`${base}/posts/${encodeURIComponent(post.slug!)}`}>{post.title}</Link></h3>{post.excerpt && <p>{post.excerpt}</p>}{post.publishedAt && <time dateTime={post.publishedAt}>{post.publishedAt.slice(0, 10)}</time>}</article>)}</div>{!posts.docs.length && <p>No published news is available to you.</p>}{pagination(posts, 'newsPage', 'News pages')}</section>}
    {pages && <section aria-label="Internal resources"><h2>Resource directory</h2><ul className="intranet-resource-list">{pages.docs.map(page => <li key={page.id}><Link href={base + '/pages' + internalPagePath(page)}>{page.title}</Link></li>)}</ul>{!pages.docs.length && <p>No published resources are available to you.</p>}{pagination(pages, 'resourcesPage', 'Resource pages')}</section>}
    {files && <section aria-label="Internal files"><h2>Files</h2><ul className="intranet-resource-list">{files.docs.map(media => <li key={media.id}><a href={`${selected.prefix}/api/publishing/media/${media.id}?site=${encodeURIComponent(selected.site)}`}>{media.publishingOriginalFilename || media.filename || media.alt || 'Download file'}</a></li>)}</ul>{!files.docs.length && <p>No files are available to you.</p>}{pagination(files, 'filesPage', 'File pages')}</section>}
  </section>
}
