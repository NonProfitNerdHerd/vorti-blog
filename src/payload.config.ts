import fs from 'fs'
import path from 'path'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import { CloudflareContext, getCloudflareContext } from '@opennextjs/cloudflare'
import { GetPlatformProxyOptions } from 'wrangler'
import { r2Storage } from '@payloadcms/storage-r2'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { searchPlugin } from '@payloadcms/plugin-search'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import { importExportPlugin } from '@payloadcms/plugin-import-export'
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Posts } from './collections/Posts'
import { Pages } from './collections/Pages'
import { Categories } from './collections/Categories'
import { Tags } from './collections/Tags'
import { Navigation } from './globals/Navigation'
import { SiteSettings } from './globals/SiteSettings'
import { organizePageHierarchy } from './plugins/organizePageHierarchy'
import { designSystemPlugin } from '@design-system/payload-design-core'
import { canManageDesign, isDesignManager } from './access/design'
import { heroBoardRegistration } from '@design-system/payload-design-core/hero-board/registration'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const realpath = (value: string) => {
  try {
    return fs.existsSync(value) ? fs.realpathSync(value) : undefined
  } catch {
    return undefined
  }
}

const isCLI = process.argv.some((value) => {
  const resolved = realpath(value)
  if (!resolved) return false
  return (
    resolved.endsWith(path.join('payload', 'bin.js')) ||
    resolved.endsWith(path.join('next', 'dist', 'bin', 'next'))
  )
})
const isProduction = process.env.NODE_ENV === 'production'

const createLog =
  (level: string, fn: typeof console.log) => (objOrMsg: object | string, msg?: string) => {
    if (typeof objOrMsg === 'string') {
      fn(JSON.stringify({ level, msg: objOrMsg }))
    } else {
      fn(JSON.stringify({ level, ...objOrMsg, msg: msg ?? (objOrMsg as { msg?: string }).msg }))
    }
  }

const cloudflareLogger = {
  level: process.env.PAYLOAD_LOG_LEVEL || 'info',
  trace: createLog('trace', console.debug),
  debug: createLog('debug', console.debug),
  info: createLog('info', console.log),
  warn: createLog('warn', console.warn),
  error: createLog('error', console.error),
  fatal: createLog('fatal', console.error),
  silent: () => { },
} as any // Use PayloadLogger type when it's exported

const cloudflare =
  isCLI || !isProduction || Boolean(process.env.DESIGN_CORE_TEST_PERSIST_PATH)
    ? await getCloudflareContextFromWrangler()
    : await getCloudflareContext({ async: true })

export default buildConfig({
  admin: {
    user: Users.slug,
    livePreview: {
      collections: ['posts', 'pages'],
      url: ({ collectionConfig, data }) => {
        if (!collectionConfig || !['posts', 'pages'].includes(collectionConfig.slug)) return null
        const slug = typeof data.slug === 'string' && data.slug ? data.slug : '__preview__'
        const path = collectionConfig.slug === 'posts' ? `/posts/${encodeURIComponent(slug)}` : `/${encodeURIComponent(slug)}`
        const id = typeof data.id === 'number' || typeof data.id === 'string' ? data.id : 'new'
        return `${path}?livePreview=${encodeURIComponent(String(id))}`
      },
      breakpoints: [
        { label: 'Desktop', name: 'desktop', width: 1440, height: 900 },
        { label: 'Tablet', name: 'tablet', width: 768, height: 1024 },
        { label: 'Mobile', name: 'mobile', width: 390, height: 844 },
      ],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Posts, Pages, Categories, Tags, Media, Users],
  globals: [Navigation, SiteSettings],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteD1Adapter({ binding: cloudflare.env.D1, ...(process.env.DESIGN_CORE_TEST_PERSIST_PATH ? { push: false } : {}) }),
  logger: isProduction ? cloudflareLogger : undefined,
  plugins: [
    designSystemPlugin({ enabled: true, blockCreator: true, templates: true, templatableCollections: ['posts'], lexicalSchemaPaths: { posts: 'collection.posts._index-0-0.content' }, canManage: canManageDesign, isDesignManager, blockPacks: [heroBoardRegistration] }),
    seoPlugin({
      collections: ['posts', 'pages'],
      tabbedUI: true,
      uploadsCollection: 'media',
      generateTitle: ({ doc }) => `${doc?.title ?? ''} | Vorti`,
      generateDescription: ({ doc }) => doc?.excerpt ?? '',
      generateImage: ({ doc }) => doc?.featuredImage,
    }),
    searchPlugin({
      collections: ['posts', 'pages'],
      searchOverrides: { admin: { group: 'Content' } },
      syncDrafts: false,
      deleteDrafts: true,
    }),
    redirectsPlugin({
      collections: ['posts', 'pages'],
      overrides: { admin: { group: 'Site' } },
    }),
    formBuilderPlugin({
      redirectRelationships: ['pages'],
      formOverrides: { admin: { group: 'Site' } },
      formSubmissionOverrides: { admin: { group: 'Site' } },
    }),
    importExportPlugin({
      collections: [
        { slug: 'posts', export: { disableJobsQueue: true }, import: { disableJobsQueue: true } },
        { slug: 'pages', export: { disableJobsQueue: true }, import: { disableJobsQueue: true } },
      ],
    }),
    nestedDocsPlugin({ collections: ['pages'] }),
    organizePageHierarchy,
    r2Storage({
      bucket: cloudflare.env.R2,
      collections: { media: true, exports: true, imports: true },
    }),
  ],
})

// Adapted from https://github.com/opennextjs/opennextjs-cloudflare/blob/d00b3a13e42e65aad76fba41774815726422cc39/packages/cloudflare/src/api/cloudflare-context.ts#L328C36-L328C46
function getCloudflareContextFromWrangler(): Promise<CloudflareContext> {
  return import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(
    ({ getPlatformProxy }) =>
      getPlatformProxy({
        environment: process.env.CLOUDFLARE_ENV,
        remoteBindings: isProduction && !process.env.DESIGN_CORE_TEST_PERSIST_PATH,
        ...(process.env.DESIGN_CORE_TEST_PERSIST_PATH ? { persist: { path: process.env.DESIGN_CORE_TEST_PERSIST_PATH } } : {}),
      } satisfies GetPlatformProxyOptions),
  )
}
