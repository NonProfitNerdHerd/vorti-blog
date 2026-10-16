'use client'
import { useAuth, useDocumentInfo, useField } from '@payloadcms/ui'
import { flattenFields, type FormDefinition } from '@design-system/payload-design-core/forms'
import { FormAnalytics } from './FormAnalytics'
import { FormSurvey } from './FormSurvey'
import { canForm, type FormsUser } from './access'

function useReports() {
  const { id, data } = useDocumentInfo()
  const { user } = useAuth()
  const site = String(data?.site || 'default')
  return { id, data, allowed: canForm(user as FormsUser, 'entries', site), canExport: canForm(user as FormsUser, 'export', site) }
}
export function AnalyticsPanel() {
  const { id, allowed } = useReports()
  const { value } = useField<FormDefinition>({ path: 'definition' })
  if (!allowed) return <p>You do not have access to this form’s analytics.</p>
  if (!id) return <p>Save the form to view analytics and completion reports.</p>
  return <FormAnalytics formID={id} labels={Object.fromEntries(flattenFields(value?.fields || []).map(field => [field.id, field.label]))} />
}
export function ResultsPanel() {
  const { id, data, allowed, canExport } = useReports()
  if (!allowed) return <p>You do not have access to this form’s entries.</p>
  if (!id) return <p>Save the form to view results and export entries.</p>
  return <FormSurvey formID={id} publishedRevision={data?.publishedRevision} canExport={canExport} />
}
