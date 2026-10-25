import { authorityClaim } from './organizations/claims'
import { publicFormsSite } from './organizations/public-site-headers'
import { websiteCopyRecords } from './organizations/website-copy'
import fs from 'fs'
import { after } from 'next/server'
import path from 'path'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor, BlocksFeature } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import { CloudflareContext, getCloudflareContext } from '@opennextjs/cloudflare'
import { GetPlatformProxyOptions } from 'wrangler'
import { r2Storage } from '@payloadcms/storage-r2'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { searchPlugin } from '@payloadcms/plugin-search'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { formsModule } from './forms/plugin'
import { crmModule } from './crm/plugin'
import { emailRuntimeFromBindings } from './crm/email-provider'
import { accountStatusGuards } from './organizations/account-guards'
import { tenantCMS } from './organizations/cms-plugin'
import { tenantUsers } from './organizations/users-plugin'
import { tenantGlobals } from './organizations/globals-plugin'
import { tenantForms } from './organizations/forms-plugin'
import { tenantWorkspace } from './organizations/workspace-plugin'
import { tenantAuthority } from './organizations/authority-plugin'
import { tenantMutationGuards } from './organizations/mutation-guards'
import { organizationAdministration } from './organizations/admin-plugin'
import { tenantEditorSite } from './organizations/editor-site'
import { importExportPlugin } from '@payloadcms/plugin-import-export'
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Posts } from './collections/Posts'
import { Pages } from './collections/Pages'
import { Categories } from './collections/Categories'
import { Tags } from './collections/Tags'
import { SiteTemplates } from './collections/SiteTemplates'
import { Navigation } from './globals/Navigation'
import { Menus, menuRenderEndpoint, menuInvalidation } from './menus/collection'
import { SiteSettings } from './globals/SiteSettings'
import { SystemSettings } from './globals/SystemSettings'
import { organizePageHierarchy } from './plugins/organizePageHierarchy'
import { contentWorkspace } from './plugins/contentWorkspace'
import { designSystemPlugin } from '@design-system/payload-design-core'
import { canManageDesign, isDesignManager } from './access/design'
import { heroBoardRegistration } from '@design-system/payload-design-core/hero-board/registration'
import { ReviewTasks, ReviewComments, ReviewActivity } from './review/collections'
import { documentReview } from './review/plugin'
import { workspaceCollections } from './review/workspace-collections'
import { projectCollections } from './review/project-collections'
import { workspaceEndpoints } from './review/workspace-endpoints'
import { workspaceFileEndpoints } from './review/workspace-files'
import { TaskProjectChanges, projectSharingEndpoints } from './review/project-sharing'
import { TaskNotificationEvents } from './review/notifications'
import { SavedViews, EventSeries } from './content-framework/collections'
import { contentTypes } from './content-framework/plugin'
import { documentURL } from '@design-system/payload-design-core'

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
const localPersistPath =
  process.env.DESIGN_CORE_TEST_PERSIST_PATH || process.env.E2E_TEST_PERSIST_PATH

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
  silent: () => {},
} as any // Use PayloadLogger type when it's exported

const cloudflare =
  isCLI || !isProduction || Boolean(localPersistPath)
    ? await getCloudflareContextFromWrangler()
    : await getCloudflareContext({ async: true })

// Explicitly managed platform tables must not be removed by a development schema push.
// Fresh isolated test databases can still bootstrap native tables before applying migrations.
const migrationManaged =
  isProduction ||
  Boolean(process.env.DESIGN_CORE_TEST_PERSIST_PATH) ||
  Boolean(
    await cloudflare.env.D1.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vc_organizations'",
    ).first(),
  )

export default buildConfig({
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: ' | VortiCause',
      icons: { icon: '/vorticause-icon.svg', shortcut: '/vorticause-icon.svg' },
      applicationName: 'VortiCause',
      description: 'VortiCause content and collaboration workspace.',
      openGraph: {
        siteName: 'VortiCause',
        title: 'VortiCause',
        description: 'Content. Collaboration. Community.',
        images: [{ url: '/vorticause-social.svg', width: 1200, height: 630, alt: 'VortiCause' }],
      },
    },
    components: {
      actions: ['./organizations/AdminSiteProvider#AdminSiteSwitcher'],
      graphics: {
        Icon: './components/VortiCauseBrand#VortiCauseIcon',
        Logo: './components/VortiCauseBrand#VortiCauseLogo',
      },
      Nav: './components/SiteDesignNav#SiteDesignNav',
      providers: ['./components/AdminPolicy#AdminPolicy'],
      views: { dashboard: { Component: './dashboard/Dashboard#Dashboard' } },
    },
    livePreview: {
      collections: ['posts', 'pages'],
      url: async ({ collectionConfig, data, req }) => {
        if (!collectionConfig || !['posts', 'pages'].includes(collectionConfig.slug)) return null
        const slug = typeof data.slug === 'string' && data.slug ? data.slug : '__preview__'
        const path =
          collectionConfig.slug === 'posts' ? documentURL({ slug }) : `/${encodeURIComponent(slug)}`
        const id = typeof data.id === 'number' || typeof data.id === 'string' ? data.id : 'new'
        const site = String(data.editorSite || data.platformSite || 'default')
        if (site !== 'default') {
          const { cmsDatabase } = await import('./organizations/cms-scope')
          const { OrganizationRepository } = await import('./organizations/repository')
          if (!req.user) return null
          const selected = await new OrganizationRepository(
            cmsDatabase(req),
            Number(req.user.id),
          ).require(site, 'content', 'read')
          return `/sites/${selected.route_key}${path}?preview=1&livePreview=${encodeURIComponent(String(id))}`
        }
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
  collections: [
    Posts,
    Pages,
    Categories,
    Tags,
    Media,
    SiteTemplates,
    Users,
    Menus,
    ReviewTasks,
    ReviewComments,
    ReviewActivity,
    ...workspaceCollections,
    ...projectCollections,
    TaskProjectChanges,
    TaskNotificationEvents,
    SavedViews,
    EventSeries,
  ],
  globals: [Navigation, SiteSettings, SystemSettings],
  endpoints: [
    menuRenderEndpoint,
    ...workspaceEndpoints,
    ...projectSharingEndpoints,
    ...workspaceFileEndpoints(cloudflare.env.WORKSPACE_FILES),
  ],
  editor: lexicalEditor({
    features: ({ defaultFeatures }) => [
      ...defaultFeatures,
      BlocksFeature({
        blocks: [
          {
            slug: 'savedViewEmbed',
            labels: { singular: 'Saved View', plural: 'Saved Views' },
            fields: [
              {
                name: 'viewID',
                label: 'Saved View',
                type: 'relationship',
                relationTo: 'saved-views',
                required: true,
                filterOptions: { _status: { equals: 'published' } },
              },
            ],
          },
        ],
      }),
    ],
  }),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteD1Adapter({ binding: cloudflare.env.D1, push: !migrationManaged }),
  logger: isProduction ? cloudflareLogger : undefined,
  plugins: [
    crmModule({ db: cloudflare.env.D1, storage: cloudflare.env.WORKSPACE_FILES, email: emailRuntimeFromBindings(cloudflare.env as CloudflareEnv & { CRM_EMAIL_ENVIRONMENT?: string; CRM_EMAIL_LIVE_SEND_ENABLED?: string; CRM_EMAIL_RESEND_API_KEY?: string }, isCLI || !isProduction || Boolean(localPersistPath)) }),
    menuInvalidation,
    designSystemPlugin({
      enabled: true,
      blockCreator: true,
      templates: true,
      templatableCollections: ['posts', 'pages'],
      canManage: canManageDesign,
      isDesignManager,
      blockPacks: [heroBoardRegistration],
    }),
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
      overrides: { admin: { group: 'Admin' } },
    }),
    formsModule({
      resolveSite: (req) =>
        publicFormsSite(req.url, req.headers) || authorityClaim(req.user)?.site || 'default',
      db: cloudflare.env.D1,
      storage: cloudflare.env.R2,
      local: Boolean(localPersistPath),
      defer: after,
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
    contentTypes,
    // The block workspace is part of the application, not a runtime feature toggle.
    // Generation, production builds and Workers must register the same admin components.
    contentWorkspace({ enabled: true }),
    documentReview,
    tenantCMS,
    tenantUsers,
    tenantGlobals,
    tenantForms,
    tenantWorkspace,
    tenantMutationGuards,
    tenantEditorSite,
    organizationAdministration({
      enabled:
        Boolean(localPersistPath) ||
        (cloudflare.env as CloudflareEnv & { ORGANIZATION_ADMIN_ENABLED?: string })
          .ORGANIZATION_ADMIN_ENABLED === 'true',
    }),
    tenantAuthority,
    websiteCopyRecords,
    accountStatusGuards(cloudflare.env.D1),
  ],
})

// Adapted from https://github.com/opennextjs/opennextjs-cloudflare/blob/d00b3a13e42e65aad76fba41774815726422cc39/packages/cloudflare/src/api/cloudflare-context.ts#L328C36-L328C46
function getCloudflareContextFromWrangler(): Promise<CloudflareContext> {
  return import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(
    ({ getPlatformProxy }) =>
      getPlatformProxy({
        ...(localPersistPath
          ? { configPath: path.resolve(dirname, '../wrangler.test.jsonc') }
          : {}),
        environment: process.env.CLOUDFLARE_ENV,
        remoteBindings: isProduction && !process.env.DESIGN_CORE_TEST_PERSIST_PATH,
        ...(localPersistPath ? { persist: { path: localPersistPath } } : {}),
      } satisfies GetPlatformProxyOptions),
  )
}
