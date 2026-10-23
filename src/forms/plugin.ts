import { requireWebsitePublishing } from '../organizations/websites'
import type { CollectionSlug, Config, Field, PayloadRequest } from 'payload'
import { APIError, ValidationError } from 'payload'
import { prepareStoredForm } from './legacy'
import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import { emptyDefinition, makeID, definitionShapeIssues, validateDefinition, type Answers, type FormDefinition, type FormField } from '@design-system/payload-design-core/forms'
import { canForm, FORM_INTERNAL, FORM_SITE, internalRequest, siteAccess, type FormsUser } from './access'
import { formCollections, siteField } from './collections'
import type { FormPlatform } from './platform'
import { formRuntimeEndpoints } from './runtime'
import { formActionEndpoints } from './action-runtime'
import { visibleAnswers, entrySchema } from './redaction'
import { formFileEndpoints } from './files'
import { resourceCollection } from './resource-config'
import { formAnalyticsEndpoints } from './analytics'
import { formSurveyEndpoints } from './surveys'
import { formPaymentEndpoints } from './payment-runtime'
import { addCMSPostFields, authorizeCMSActions, cmsCollections } from './cms-actions'
import { formExportEndpoints } from './exports'
import { formReceiptEndpoints } from './receipts'
import { validateEntryReview, auditEntryReview } from './entry-workflow'
import { isFormDraftOperation } from './publication'

const text = (name: string, label?: string): Field => ({ name, label, type: 'text' })
const trusted = (req: PayloadRequest): PayloadRequest => ({ ...req, context: { ...req.context, formsOperation: 'published-snapshot', [FORM_INTERNAL]: true } })
export const formsModule = (platform: FormPlatform) => (config: Config): Config => {
  const enhanced = formBuilderPlugin({
    redirectRelationships: ['pages'],
    // Original hooks remain installed. Delivery is owned by the durable action queue.
    beforeEmail: () => [],
    formOverrides: {
      admin: { components: { Description: '@design-system/payload-design-core/admin#EditorTitleSlot', edit: { beforeDocumentControls: ['@design-system/payload-design-core/admin#EditorPreviewSlot'] } }, group: 'Forms', defaultColumns: ['title', 'slug', '_status', 'updatedAt'] },
      versions: { drafts: { autosave: { interval: 5000 } }, maxPerDoc: 50 },
      lockDocuments: { duration: 300 },
      access: { read: siteAccess('edit'), create: siteAccess('create'), update: siteAccess('edit'), delete: () => false },
      fields: ({ defaultFields }) => {
        const fields: Field[] = [
        ...defaultFields.map((field): Field => {
          const result = { ...field }
          if ('name' in result && result.name !== 'title') {
            // Retain legacy storage without exposing a second editing interface.
            result.admin = { ...result.admin, condition: () => false }
            if ('required' in result) result.required = false
          }
          if ('name' in result && result.name === 'title') result.admin = { ...result.admin, components: { Field: './forms/FormTitle#FormTitle' } }
          return result
        }),
        { name: 'slug', type: 'text', unique: true, index: true, admin: { description: 'Public address: /forms/your-slug' } },
        { name: 'description', type: 'textarea' }, { name: 'internalNotes', type: 'textarea' },
        text('category'), { name: 'tags', type: 'text', hasMany: true },
        { name: 'owner', type: 'relationship', relationTo: 'users' }, siteField, text('locale'),
        { name: 'archived', type: 'checkbox', defaultValue: false },
        { name: 'definition', type: 'json', admin: { components: { Field: './forms/FormWorkspace#FormWorkspace' } } },
        { name: 'publishedRevision', type: 'text', admin: { hidden: true }, access: { update: ({ req }) => internalRequest(req) } },
      ]
        const named = (name: string) => fields.find(field => 'name' in field && field.name === name)!
        return [{ type: 'group', admin: { components: { Field: './forms/FormEditorTabs#FormEditorTabs' } }, fields: [
          { type: 'group', label: 'Build', fields: [named('title'), named('definition')] },
          ...['Logic', 'Design', 'Actions', 'Access', 'Email'].map((label): Field => ({ type: 'group', label, fields: [] })),
          { type: 'group', label: 'Details', fields: fields.filter(field => !('name' in field) || !['title', 'definition'].includes(field.name)) },
          { type: 'group', label: 'Analytics', fields: [{ name: 'formAnalytics', type: 'ui', admin: { components: { Field: './forms/FormReports#AnalyticsPanel' } } }] },
          { type: 'group', label: 'Results', fields: [{ name: 'formResults', type: 'ui', admin: { components: { Field: './forms/FormReports#ResultsPanel' } } }] },
          { type: 'group', label: 'Import / Export', fields: [] },
        ] }]
      },
      hooks: {
        beforeOperation: [({ args, operation }) => {
          if (operation === 'create' || operation === 'update') args.req.context.formsSavingDraft = isFormDraftOperation(operation, args)
          return args
        }],
        beforeValidate: [async ({ data, originalDoc, operation, req }) => {
          if (!data) return data
          const site = String(data.site || originalDoc?.site || FORM_SITE)
          if (data._status === 'published') await requireWebsitePublishing(platform.db,site)
          if (!internalRequest(req) && !canForm(req.user as FormsUser, operation === 'create' ? 'create' : 'edit', site)) throw new APIError('You cannot edit forms in this site.', 403)
          if (originalDoc?.site && site !== originalDoc.site) throw new ValidationError({ errors: [{ path: 'site', message: 'A form cannot move between sites.' }] })
          data.site = site
          if (!data.slug && !originalDoc?.slug && data.title) {
            const suggested = String(data.title).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
            data.slug = /^[a-z]/.test(suggested) ? suggested : `form-${suggested || crypto.randomUUID().slice(0, 8)}`
          }
          // Payload creates an empty autosave draft before opening the editor.
          // The pre-existing Forms table requires a title even for that scaffold.
          if (operation === 'create' && !data.title && req.context.formsSavingDraft === true) data.title = 'Untitled form'
          if (operation === 'create' && data.definition === undefined && !data.fields?.length && !data.emails?.length) {
            data.definition = { ...emptyDefinition(), fields: [{ id: makeID(), kind: 'step', label: 'Canvas 1', width: 12, children: [] }] }
          }
          const legacy = { ...originalDoc, ...data }
          const pendingLegacy = !originalDoc?.definition || (legacy.emails?.length && !originalDoc.definition.legacyEmailsImported)
          if (pendingLegacy && (legacy.fields?.length || legacy.emails?.length)) {
            // Review is derived from the saved source, not a client-supplied marker.
            const source = prepareStoredForm({ ...legacy, definition: originalDoc?.definition })
            const submitted = data.definition || source.definition
            if (source.issues.some(issue => !Array.isArray(submitted.legacyReview) || !submitted.legacyReview.includes(issue.message))) throw new ValidationError({ errors: [{ path: 'definition', message: 'Review and acknowledge the listed legacy settings in Build and Email before saving the converted form.' }] })
            data.definition = { ...submitted, ...(legacy.emails?.length ? { legacyEmailsImported: true } : {}) }
          }
          if (data.definition && typeof data.definition === 'object' && originalDoc?.definition?.legacyEmailsImported === true) data.definition = { ...data.definition, legacyEmailsImported: true }
          if (data.definition !== undefined) {
            const issues = definitionShapeIssues(data.definition)
            if (issues.length) throw new ValidationError({ errors: issues.map(issue => ({ path: 'definition', message: issue.message })) })
          }
          // Preserve the legacy table's NOT NULL confirmation column without rebuilding it.
          if (data.definition && !data.confirmationMessage && !originalDoc?.confirmationMessage) data.confirmationMessage = {
            root: { type: 'root', version: 1, children: [{ type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text: 'Thank you.', format: 0, detail: 0, mode: 'normal', style: '' }], direction: null, format: '', indent: 0 }], direction: null, format: '', indent: 0 },
          }
          if (data.slug && !/^[a-z][a-z0-9-]*$/.test(data.slug)) throw new ValidationError({ errors: [{ path: 'slug', message: 'Use lowercase letters, numbers and hyphens for the public address.' }] })
          if (req.context.formsSavingDraft !== true && (data._status ?? originalDoc?._status) === 'published' && !internalRequest(req)) {
            if (!canForm(req.user as FormsUser, 'publish', site)) throw new APIError('You cannot publish forms.', 403)
            const definition = data.definition || originalDoc?.definition
            if (definition) {
              if ((definition as FormDefinition).payment?.provider === 'simulator' && !platform.local) throw new ValidationError({ errors: [{ path: 'definition', message: 'The payment simulator is available only in development. Choose Stripe test mode.' }] })
              const issues = validateDefinition(definition as FormDefinition)
              if (issues.length) throw new ValidationError({ errors: issues.map(issue => ({ path: 'definition', message: `${issue.field || issue.rule || 'Form'}: ${issue.message}` })) })
              data.definition = await authorizeCMSActions(definition as FormDefinition, req, site)
            }
          }
          return data
        }],
        afterChange: [async ({ doc, req }) => {
          if (internalRequest(req) || req.context.formsSavingDraft === true || doc._status !== 'published' || !doc.definition) return doc
          const revision = crypto.randomUUID()
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(doc.definition))))).map(n => n.toString(16).padStart(2, '0')).join('')
          const internal = trusted(req)
          await req.payload.create({ collection: 'form-revisions' as CollectionSlug, req: internal, overrideAccess: true, data: {
            label: `${doc.title} · ${revision.slice(0, 8)}`, site: doc.site, form: doc.id, revision, definition: doc.definition, title: doc.title, slug: doc.slug, digest,
          } as never })
          await req.payload.update({ collection: 'forms', id: doc.id, req: internal, overrideAccess: true, data: { publishedRevision: revision } as never, context: internal.context })
          return { ...doc, publishedRevision: revision }
        }],
      },
    },
    formSubmissionOverrides: {
      labels: { singular: 'Entry', plural: 'Entries' },
      admin: { group: 'Forms', defaultColumns: ['form', 'workflowStatus', 'read', 'starred', 'createdAt'] },
      access: { create: ({ req }) => internalRequest(req), read: siteAccess('entries'), update: siteAccess('entries'), delete: siteAccess('admin') },
      fields: ({ defaultFields }) => [...defaultFields, siteField,
        { name: 'revision', type: 'text', index: true },
        { name: 'idempotencyKey', type: 'text', unique: true, index: true },
        { name: 'answers', type: 'json', admin: { readOnly: true, components: { Field: './forms/EntryDetails#EntryDetails' } }, access: { update: ({ req }) => internalRequest(req) } },
        { name: 'schemaSnapshot', type: 'json', admin: { hidden: true }, access: { update: ({ req }) => internalRequest(req) } },
        { name: 'workflowStatus', type: 'select', defaultValue: 'received', options: ['received', 'in-review', 'approved', 'rejected', 'completed'] },
        { name: 'read', type: 'checkbox', defaultValue: false }, { name: 'starred', type: 'checkbox', defaultValue: false },
        { name: 'spam', type: 'checkbox', defaultValue: false }, { name: 'archived', type: 'checkbox', defaultValue: false },
        { name: 'reviewer', type: 'relationship', relationTo: 'users' }, { name: 'notes', type: 'textarea' },
        { name: 'tags', type: 'text', hasMany: true },
        { name: 'paymentStatus', type: 'select', defaultValue: 'none', options: ['none', 'pending', 'paid', 'failed', 'canceled', 'refunded', 'simulated'] },
        text('paymentReference'), text('sessionHash'),
      ],
      hooks: { afterRead: [({ doc, req }) => {
        if (!internalRequest(req) && doc.schemaSnapshot?.fields) {
          const sensitive = canForm(req.user as FormsUser, 'sensitive', doc.site || FORM_SITE)
          return { ...doc,
            answers: visibleAnswers(doc.schemaSnapshot.fields as FormField[], (doc.answers || {}) as Answers, sensitive),
            schemaSnapshot: { title: doc.schemaSnapshot.title, fields: entrySchema(doc.schemaSnapshot.fields as FormField[], sensitive) },
          }
        }
        return doc
      }], afterChange: [auditEntryReview(platform)], beforeChange: [validateEntryReview, ({ data, originalDoc, req, operation }) => {
        if (operation === 'update' && !internalRequest(req)) {
          for (const key of ['form', 'site', 'revision', 'answers', 'schemaSnapshot', 'submissionData', 'idempotencyKey', 'paymentStatus', 'paymentReference', 'sessionHash']) {
            if (key in data && JSON.stringify(data[key]) !== JSON.stringify(originalDoc[key])) throw new ValidationError({ errors: [{ path: key, message: 'Original submission data is immutable.' }] })
          }
        }
        return data
      }] },
    },
  })({ ...config, collections: [...(config.collections || []).map(addCMSPostFields), ...cmsCollections, ...formCollections.map(collection => collection.slug === 'form-resources' ? resourceCollection(collection, platform) : collection)] })
  return { ...enhanced, endpoints: [...enhanced.endpoints || [], ...formRuntimeEndpoints(platform), ...formActionEndpoints(platform), ...formFileEndpoints(platform), ...formAnalyticsEndpoints(platform), ...formSurveyEndpoints(platform), ...formExportEndpoints(platform), ...formReceiptEndpoints(platform), ...formPaymentEndpoints(platform)] }
}
