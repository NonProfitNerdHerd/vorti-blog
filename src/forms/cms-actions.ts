import { APIError, ValidationError, createLocalReq, type CollectionConfig, type CollectionSlug, type Endpoint, type Payload, type PayloadRequest } from 'payload'
import { cmsActionIssues, cmsMappings, mappedCMSText, type Answers, type FormAction, type FormDefinition } from '@design-system/payload-design-core/forms'
import { canForm, FORM_INTERNAL, FORM_SITE, internalRequest, siteAccess, type FormsUser } from './access'
import { PermanentActionError, type ActionHandlers } from './outbox'
import type { FormPlatform } from './platform'
import { hashToken } from './security'

const protectedField = { admin: { readOnly: true }, access: { create: ({ req }: { req: PayloadRequest }) => internalRequest(req), update: () => false } }
export const cmsCollections: CollectionConfig[] = [
  { slug: 'form-contacts', labels: { singular: 'Form contact', plural: 'Form contacts' }, admin: { group: 'Forms', useAsTitle: 'email', defaultColumns: ['name', 'email', 'sourceEntry', 'updatedAt'] }, fields: [
    { name: 'name', type: 'text' }, { name: 'email', type: 'email', required: true }, { name: 'notes', type: 'textarea' },
  ] },
  { slug: 'form-support-requests', labels: { singular: 'Support request', plural: 'Support requests' }, admin: { group: 'Forms', useAsTitle: 'title', defaultColumns: ['title', 'status', 'reviewer', 'updatedAt'] }, fields: [
    { name: 'title', type: 'text', required: true }, { name: 'details', type: 'textarea', required: true }, { name: 'email', type: 'email' },
    { name: 'status', type: 'select', defaultValue: 'received', options: ['received', 'in-review', 'completed', 'archived'] },
    { name: 'reviewer', type: 'relationship', relationTo: 'users' }, { name: 'notes', type: 'textarea' },
  ] },
].map(collection => ({ ...collection,
  access: { read: args => siteAccess(internalRequest(args.req) ? 'integrations' : 'entries')(args), create: ({ req, data }) => internalRequest(req) && canForm(req.user as FormsUser, 'integrations', String(data?.site || FORM_SITE)), update: siteAccess('entries'), delete: () => false },
  fields: [
    { name: 'site', type: 'text', required: true, index: true, ...protectedField },
    { name: 'actionKey', type: 'text', unique: true, index: true, required: true, ...protectedField, admin: { hidden: true } },
    { name: 'sourceEntry', type: 'relationship', relationTo: 'form-submissions', ...protectedField },
    ...collection.fields,
  ],
})) as CollectionConfig[]

/** Posts currently belong to the default site; do not leak other sites into a global collection. */
export async function authorizeCMSActions(definition: FormDefinition, req: PayloadRequest, site: string): Promise<FormDefinition> {
  const actions = definition.actions.filter(action => cmsMappings[action.kind])
  if (!actions.length) return definition
  if (!canForm(req.user as FormsUser, 'integrations', site)) throw new APIError('Integration permission is required to publish CMS record actions.', 403)
  for (const action of actions) {
    const issues = cmsActionIssues(action, definition)
    if (action.kind === 'content') {
      if (site !== FORM_SITE) issues.push('The Posts collection belongs to the default site. Register a scoped destination for another site.')
      if (!issues.length) {
        const type = await req.payload.find({ collection: 'post-types', where: { and: [{ id: { equals: action.config.postType } }, { _status: { equals: 'published' } }, { archived: { not_equals: true } }] }, limit: 1, draft: false, depth: 0, overrideAccess: false, req })
        if (!type.docs.length) issues.push('Select an available published Post Type.')
      }
    }
    if (issues.length) throw new ValidationError({ errors: issues.map(message => ({ path: 'definition', message: `${action.name}: ${message}` })) })
  }
  return { ...definition, actions: definition.actions.map(action => cmsMappings[action.kind] ? { ...action, config: { ...action.config, approvedBy: String(req.user!.id) } } : action) }
}

export function addCMSPostFields(collection: CollectionConfig): CollectionConfig {
  if (collection.slug !== 'posts') return collection
  return { ...collection, fields: [...collection.fields, {
    name: 'formActionKey', type: 'text', unique: true, index: true, admin: { hidden: true },
    access: { create: ({ req }) => internalRequest(req), update: () => false, read: ({ req }) => internalRequest(req) || canForm(req.user as FormsUser, 'entries') },
  }] }
}

function lexicalText(text: string) {
  return { root: { type: 'root', version: 1, direction: null as null, format: '' as const, indent: 0, children: text.split(/\r?\n/).map(line => ({ type: 'paragraph', version: 1, direction: null as null, format: '' as const, indent: 0, children: [{ type: 'text', version: 1, text: line, format: 0, detail: 0, mode: 'normal', style: '' }] })) } }
}
export function cmsRecordData(action: FormAction, answers: Answers, actorID: number | string): Record<string, unknown> {
  if (action.kind === 'contact') return { name: mappedCMSText(answers, action, 'nameField'), email: mappedCMSText(answers, action, 'emailField', true) }
  if (action.kind === 'support') return { title: mappedCMSText(answers, action, 'titleField', true), details: mappedCMSText(answers, action, 'bodyField', true), email: mappedCMSText(answers, action, 'emailField') || undefined, status: 'received' }
  if (action.kind === 'content') return { title: mappedCMSText(answers, action, 'titleField', true), content: lexicalText(mappedCMSText(answers, action, 'bodyField', true)), postType: Number(action.config.postType), author: actorID, _status: 'draft' }
  throw new PermanentActionError('This CMS destination is not registered.')
}

export function registerCMSHandlers(handlers: ActionHandlers, platform: FormPlatform, payload: Payload): void {
  for (const [kind, collection] of Object.entries({ contact: 'form-contacts', support: 'form-support-requests', content: 'posts' })) handlers.register(kind, async ({ job, action }) => {
    const approvedBy = String(action.config.approvedBy || '')
    if (!/^\d+$/.test(approvedBy)) throw new PermanentActionError('Publish this form with an authorized integration manager before running CMS actions.')
    // This one privileged read retrieves only the stored approver. Target writes enforce access below.
    const actor = await payload.findByID({ collection: 'users', id: Number(approvedBy), depth: 0, overrideAccess: true }).catch((error): null => {
      if (error instanceof APIError && error.status === 404) return null
      throw error
    })
    if (!actor || !canForm(actor, 'integrations', job.site)) throw new PermanentActionError('The approving user no longer has integration permission. Republish the form with an authorized user.')
    if (kind === 'content' && job.site !== FORM_SITE) throw new PermanentActionError('This Posts destination is not available in this site.')
    const entry = await platform.db.prepare('SELECT answers,schema_snapshot FROM form_submissions WHERE id=? AND site=? AND revision=?').bind(job.submission_i_d, job.site, job.revision).first<{ answers: string; schema_snapshot: string }>()
    if (!entry) throw new PermanentActionError('The original submission is unavailable.')
    const issues = cmsActionIssues(action, JSON.parse(entry.schema_snapshot))
    if (issues.length) throw new PermanentActionError(issues.join(' '))
    // Payload treats a symbol-only context as empty during nested Local API calls.
    // The named operation preserves it; authorization still requires the unforgeable symbol.
    const req = await createLocalReq({ user: { ...actor, collection: 'users' }, context: { formsOperation: 'cms-action', [FORM_INTERNAL]: true } }, payload)
    const key = await hashToken(JSON.stringify([job.site, job.event_i_d, kind])), keyField = kind === 'content' ? 'formActionKey' : 'actionKey'
    const find = () => payload.find({ collection: collection as CollectionSlug, where: { and: [{ [keyField]: { equals: key } }, ...(kind === 'content' ? [] : [{ site: { equals: job.site } }])] }, limit: 1, depth: 0, draft: true, overrideAccess: false, req, context: req.context })
    if ((await find()).docs.length) return
    let data: Record<string, unknown>
    try { data = cmsRecordData(action, JSON.parse(entry.answers), actor.id) } catch (error) { throw new PermanentActionError((error as Error).message) }
    if (kind === 'content') {
      const type = await payload.find({ collection: 'post-types', where: { and: [{ id: { equals: action.config.postType } }, { _status: { equals: 'published' } }, { archived: { not_equals: true } }] }, limit: 1, draft: false, depth: 0, overrideAccess: false, req, context: req.context })
      if (!type.docs.length) throw new PermanentActionError('The approved Post Type is unavailable. Review the form mapping.')
      data = { ...data, slug: `form-${key}`, formActionKey: key }
    } else data = { ...data, site: job.site, sourceEntry: Number(job.submission_i_d), actionKey: key }
    try { await payload.create({ collection: collection as CollectionSlug, data: data as never, draft: kind === 'content', overrideAccess: false, req, context: req.context }) }
    catch (error) {
      if (!(await find()).docs.length) {
        if (error instanceof ValidationError) throw new PermanentActionError('The destination rejected the mapped values. Review its required fields and Post Type configuration.')
        throw error
      }
    }
  })
}

export function cmsActionEndpoints(platform: FormPlatform): Endpoint[] {
  return [{ path: '/forms-cms/options', method: 'get', handler: async req => {
    const site = platform.resolveSite?.(req) || FORM_SITE
    if (!canForm(req.user as FormsUser, 'integrations', site)) return Response.json({ message: 'Integration permission is required.' }, { status: 403 })
    const types = site === FORM_SITE ? await req.payload.find({ collection: 'post-types', where: { and: [{ _status: { equals: 'published' } }, { archived: { not_equals: true } }] }, limit: 100, depth: 0, draft: false, overrideAccess: false, req }) : { docs: [] as { id: number; singular?: string }[] }
    return Response.json({ postTypes: types.docs.map(type => ({ id: String(type.id), label: type.singular || `Post Type ${type.id}` })) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } }]
}
