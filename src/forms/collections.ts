import type { Access, CollectionConfig, Field } from 'payload'
import { APIError } from 'payload'
import { FORM_SITE, internalRequest, siteAccess, permittedSites, type FormsUser } from './access'

export const siteField: Field = { name: 'site', type: 'text', required: true, defaultValue: FORM_SITE, index: true, admin: { readOnly: true } }
const serverOnly: Access = ({ req }) => internalRequest(req)
const base = (slug: string, title: string, fields: Field[], permission: 'edit' | 'entries' | 'integrations' | 'admin' | 'export' = 'admin'): CollectionConfig => ({
  slug, labels: { singular: title, plural: `${title}s` }, admin: { group: 'Forms', useAsTitle: 'label' },
  access: { read: siteAccess(permission), create: serverOnly, update: serverOnly, delete: serverOnly },
  fields: [{ name: 'label', type: 'text' }, siteField, ...fields],
})
const json = (name: string, label?: string): Field => ({ name, label, type: 'json' })
const text = (name: string, extra: Partial<Field> = {}): Field => ({ name, type: 'text', ...extra } as Field)
const number = (name: string): Field => ({ name, type: 'number' })
const date = (name: string): Field => ({ name, type: 'date', index: true })
export const FormRevisions = base('form-revisions', 'Form revision', [
  { name: 'form', type: 'relationship', relationTo: 'forms', required: true, index: true },
  text('revision', { required: true, unique: true }), json('definition'), text('title'), text('slug'), text('digest'),
  date('retiredAt'),
], 'edit')
FormRevisions.hooks = { beforeChange: [({ operation, req, data }) => {
  if (operation === 'update' && (!internalRequest(req) || Object.keys(data).some(key => !['retiredAt', 'updatedAt'].includes(key)))) throw new APIError('Published form revisions are immutable.', 400)
  return data
}] }
export const FormDrafts = base('form-drafts', 'Saved progress', [
  text('revision', { required: true, index: true }), text('tokenHash', { unique: true, index: true }), text('ownerID', { index: true }),
  json('answers'), date('expiresAt'), date('revokedAt'), text('sessionHash'),
], 'admin')
export const FormAttachments = base('form-attachments', 'Private attachment', [
  text('revision', { required: true, index: true }), text('sessionHash', { required: true }), text('objectKey', { required: true }),
  text('filename'), text('mime'), number('bytes'), text('fieldID'), text('submissionID'), date('expiresAt'),
  { name: 'scanStatus', type: 'select', defaultValue: 'unscanned', options: ['unscanned', 'pending', 'clean', 'rejected', 'error', 'deleting'] },
], 'entries')
export const FormOutbox = base('form-outbox', 'Form action', [
  text('eventID', { required: true, unique: true }), text('submissionID', { index: true }), text('revision'), text('kind'),
  { name: 'status', type: 'select', defaultValue: 'pending', options: ['pending', 'running', 'waiting-payment', 'complete', 'failed', 'unconfigured'] },
  json('payload'), number('attempts'), date('nextAttemptAt'), date('leaseUntil'), json('attemptLog'),
], 'integrations')
export const FormAudit = base('form-audit', 'Form audit entry', [text('submissionID', { index: true }), text('actorID'), text('action'), json('changes')], 'entries')
export const FormAnalytics = base('form-analytics', 'Form analytics event', [text('formID', { index: true }), text('revision'), text('eventID', { unique: true }), text('sessionHash'), text('kind'), text('step'), number('durationMs'), json('fieldIDs')], 'entries')
export const FormDeliveries = base('form-deliveries', 'Local delivery', [text('kind'), text('eventID', { unique: true }), text('recipient'), text('subject'), text('body'), json('headers')], 'integrations')
FormDeliveries.fields = FormDeliveries.fields.map(field => 'name' in field && field.name === 'body' ? { ...field, admin: { components: { Field: './forms/LocalDeliveryMessage#LocalDeliveryMessage' } } } : field)
export const FormResources = base('form-resources', 'Booking resource', [text('timezone', { defaultValue: 'UTC', admin: { components: { Field: './components/SiteTimezoneField#SiteTimezoneField' } } }), json('availability'), { name: 'capacity', label: 'Default places per slot', type: 'number', defaultValue: 1, min: 1, max: 1000 }, { name: 'holdMinutes', label: 'Temporary hold (minutes)', type: 'number', defaultValue: 10, min: 1, max: 60 }], 'edit')
FormResources.hooks = { beforeOperation: [async ({ args, operation }) => {
  if (operation === 'create' && 'data' in args && !args.data.timezone) {
    const site = await args.req.payload.findGlobal({ slug: 'site-settings', depth: 0, req: args.req })
    args.data.timezone = site.timezone || 'UTC'
  }
  return args
}] }
FormResources.access = { read: siteAccess('edit'), create: siteAccess('edit'), update: siteAccess('edit'), delete: siteAccess('admin') }
export const FormTemplates = base('form-templates', 'Form template', [json('definition'), { name: 'kind', type: 'select', options: ['template', 'field-group', 'theme'], defaultValue: 'template' }, json('theme'), text('revision')], 'edit')
FormTemplates.access = { read: siteAccess('edit'), create: siteAccess('edit'), update: siteAccess('edit'), delete: siteAccess('admin') }
FormTemplates.admin = { ...FormTemplates.admin, hidden: true }
export const FormIntegrations = base('form-integrations', 'Form integration', [text('provider'), text('credentialName'), json('settings'), { name: 'enabled', type: 'checkbox', defaultValue: false }], 'integrations')
FormIntegrations.access = { read: siteAccess('integrations'), create: siteAccess('integrations'), update: siteAccess('integrations'), delete: siteAccess('admin') }
export const FormExports = base('form-exports', 'Form export', [text('status'), text('requestedBy'), json('filters'), json('columns'), text('format'), text('objectKey'), date('expiresAt'), text('error')], 'export')
FormExports.fields = FormExports.fields.map(field => 'name' in field && field.name === 'status' ? { ...field, admin: { components: { Field: './forms/FormExportStatus#FormExportStatus' } } } : field)
FormExports.access = { ...FormExports.access, read: ({ req }) => {
  const sites = permittedSites(req.user as FormsUser, 'export')
  return sites.length && req.user ? { and: [{ site: { in: sites } }, { requestedBy: { equals: String(req.user.id) } }] } : false
} }
export const formCollections: CollectionConfig[] = [FormRevisions, FormDrafts, FormAttachments, FormOutbox, FormAudit, FormAnalytics, FormDeliveries, FormResources, FormTemplates, FormIntegrations, FormExports]
