import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { ContactWorkspace } from '../crm/ContactWorkspace'
import { redirect } from 'next/navigation'

export function CRMAdminView(props: AdminViewServerProps) {
  const { req, visibleEntities, permissions, locale } = props.initPageResult
  return (
    <DefaultTemplate
      req={req}
      viewActions={req.payload.config.admin.components.actions}
      visibleEntities={visibleEntities}
      permissions={permissions}
      locale={locale}
      i18n={req.i18n}
      payload={req.payload}
      user={req.user}
    >
      <ContactWorkspace />
    </DefaultTemplate>
  )
}

export function SitesCompatibilityView({ initPageResult }: AdminViewServerProps) {
  const url = new URL(initPageResult.req.url!)
  const site = url.searchParams.get('site')
  redirect(
    `${initPageResult.req.payload.config.routes.admin}/globals/site-settings?tab=SubSites${site ? '&site=' + encodeURIComponent(site) : ''}`,
  )
}
