import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { notFound } from 'next/navigation'
import { cmsDatabase } from '../organizations/cms-scope'
import { PublishingGroups } from './groups'
import { GroupsWorkspace } from './GroupsWorkspace'

export async function GroupsPage({ initPageResult }: AdminViewServerProps) {
  const { req, visibleEntities, permissions, locale } = initPageResult
  if (!req.user) notFound()
  const site = new URL(req.url!).searchParams.get('site') || req.headers.get('x-vorticause-site') || 'default'
  const initial = await new PublishingGroups(cmsDatabase(req), Number(req.user.id)).list(site)
  return <DefaultTemplate req={req} viewActions={req.payload.config.admin.components.actions} visibleEntities={visibleEntities} permissions={permissions} locale={locale} i18n={req.i18n} payload={req.payload} user={req.user}>
    <GroupsWorkspace site={site} initial={initial} />
  </DefaultTemplate>
}
