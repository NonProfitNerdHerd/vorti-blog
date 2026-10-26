import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { AutomationsWorkspace } from './Workspace'
export function AutomationsAdminView({ initPageResult }: AdminViewServerProps) {
  const { req, visibleEntities, permissions, locale } = initPageResult
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
      <AutomationsWorkspace />
    </DefaultTemplate>
  )
}
