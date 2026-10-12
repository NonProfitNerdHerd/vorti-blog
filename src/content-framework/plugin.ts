import type { Plugin, CollectionSlug } from 'payload'
import { ValidationError } from 'payload'
import { publishedType, refID } from './collections'
import { validateValues } from './validation'
import {
  eventInstant,
  createPayloadDesignStore,
  validateTemplatedContent,
  type TypeField,
  type EventSchedule,
  evaluateFieldRules,
  type MediaFacts,
} from '@design-system/payload-design-core'
export const contentTypes: Plugin = (config) => {
  for (const collection of config.collections || []) {
    if (!['posts', 'pages', 'design-templates', 'site-templates'].includes(collection.slug))
      continue
    collection.hooks = {
      ...collection.hooks,
      beforeChange: [
        ...(collection.hooks?.beforeChange || []),
        async ({ data, originalDoc, req }) => {
          if ((data._status ?? originalDoc?._status) !== 'published') return data
          const ids = new Set<string | number>()
          const visit = (value: unknown): void => {
            if (!value || typeof value !== 'object') return
            const object = value as Record<string, unknown>
            const reference = refID(object.viewID)
            if (reference) ids.add(reference)
            Object.values(object).forEach(visit)
          }
          visit({ ...originalDoc, ...data })
          const document = { ...originalDoc, ...data }
          const type =
            collection.slug === 'posts'
              ? await publishedType(req.payload, document.postType, req)
              : undefined
          for (const field of (type?.fieldDefinitions || []) as TypeField[]) {
            if (field.kind === 'relationship' && field.relationTo === 'saved-views') {
              const reference = refID(document.postTypeValues?.[field.id])
              if (reference) ids.add(reference)
            }
          }
          const templateID = refID(document.designTemplate) || refID(type?.defaultTemplate)
          if (templateID) {
            const template = await req.payload.findByID({
              collection: 'design-templates',
              id: templateID,
              draft: false,
              depth: 0,
              overrideAccess: false,
              req,
            })
            for (const field of (template.customFields || []) as Array<{
              id: string
              fieldType: string
              relationTo?: string
            }>) {
              if (field.fieldType === 'relationship' && field.relationTo === 'saved-views') {
                const reference = refID(document.templateValues?.[field.id])
                if (reference) ids.add(reference)
              }
            }
          }
          for (const id of ids) {
            const view = await req.payload.find({
              collection: 'saved-views',
              where: { and: [{ id: { equals: id } }, { _status: { equals: 'published' } }] },
              draft: false,
              depth: 0,
              limit: 1,
              overrideAccess: false,
              req,
            })
            if (!view.docs.length)
              throw new Error('Publish the referenced Saved View before publishing its placement')
          }
          return data
        },
      ],
    }
  }
  const templates = config.collections?.find((c) => c.slug === 'design-templates')
  if (templates)
    templates.hooks = {
      ...templates.hooks,
      beforeChange: [
        ...(templates.hooks?.beforeChange || []),
        async ({ data, originalDoc, req }) => {
          if (!originalDoc?.id || (data._status ?? originalDoc._status) !== 'published') return data
          const types = await req.payload.find({
            collection: 'post-types',
            where: {
              and: [
                { templates: { contains: originalDoc.id } },
                { _status: { equals: 'published' } },
              ],
            },
            pagination: false,
            depth: 0,
            overrideAccess: true,
            req,
          })
          const bindings: string[] = []
          const visit = (value: unknown): void => {
            if (!value || typeof value !== 'object') return
            const object = value as Record<string, unknown>
            if (object.source === 'postType' && typeof object.fieldId === 'string')
              bindings.push(object.fieldId)
            Object.values(object).forEach(visit)
          }
          visit(data.layout ?? originalDoc.layout)
          for (const type of types.docs)
            for (const id of bindings)
              if (
                !((type.fieldDefinitions || []) as TypeField[]).some((f) => f.id === id && f.public)
              )
                throw new Error(`Template binding ${id} is missing or private for ${type.singular}`)
          return data
        },
      ],
    }
  const posts = config.collections?.find((c) => c.slug === 'posts')
  if (!posts) return config
  posts.admin = { ...posts.admin, defaultColumns: ['title', 'postType', '_status', 'updatedAt'] }
  posts.fields.unshift(
    {
      name: 'postType',
      type: 'relationship',
      relationTo: 'post-types' as CollectionSlug,
      index: true,
      filterOptions: {
        and: [{ _status: { equals: 'published' } }, { archived: { not_equals: true } }],
      },
      admin: { description: 'Content fields and available Templates come from this Post Type.' },
    },
    {
      name: 'postTypeValues',
      type: 'json',
      defaultValue: {},
      admin: { components: { Field: './content-framework/TypeValues#TypeValues' } },
    },
  )
  posts.hooks = {
    ...posts.hooks,
    beforeOperation: [
      ...(posts.hooks?.beforeOperation || []),
      ({ args, operation }) => {
        if (operation === 'create' || operation === 'update')
          args.req.context.postTypeSavingDraft = 'draft' in args && args.draft === true
        return args
      },
    ],
    beforeChange: [
      ...(posts.hooks?.beforeChange || []),
      async ({ data, originalDoc, req }) => {
        const type = await publishedType(req.payload, data.postType ?? originalDoc?.postType, req)
        const explicit =
          'designTemplate' in data ? data.designTemplate : originalDoc?.designTemplate
        const template = refID(explicit) || refID(type?.defaultTemplate)
        if (template && !explicit) {
          const issues = await validateTemplatedContent(
            createPayloadDesignStore(req.payload, req),
            {
              id: originalDoc?.id ?? 'new',
              template,
              templateValues: data.templateValues ?? originalDoc?.templateValues ?? {},
              designOverrides: {},
            },
          )
          if (issues.length && (data._status ?? originalDoc?._status) === 'published')
            throw new Error(issues.map((issue) => issue.message).join('; '))
        }
        return data
      },
    ],
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        if (!data) return data
        const reference = 'postType' in data ? data.postType : originalDoc?.postType
        const type = await publishedType(req.payload, reference, req)
        if (!type) {
          if (reference) throw new Error('Select a published Post Type')
          return data
        }
        if (type.archived && !originalDoc) throw new Error('This Post Type is archived')
        if (
          originalDoc &&
          refID(originalDoc.postType) &&
          String(refID(originalDoc.postType)) !== String(type.id) &&
          req.user?.role !== 'administrator'
        )
          throw new Error('Only administrators may change an existing Post Type')
        const fields = (type.fieldDefinitions || []) as TypeField[]
        const values = { ...(originalDoc?.postTypeValues || {}), ...(data.postTypeValues || {}) }
        for (const f of fields)
          if (values[f.id] === undefined && f.defaultValue !== undefined)
            values[f.id] = f.defaultValue
        const publishing =
          req.context.postTypeSavingDraft !== true &&
          (data._status ?? originalDoc?._status) === 'published'
        validateValues(fields, values, false)
        const media: MediaFacts = {}
        for (const f of fields)
          if (['media', 'relationship'].includes(f.kind) && values[f.id]) {
            const related = await req.payload.findByID({
              collection: (f.kind === 'media' ? 'media' : f.relationTo) as CollectionSlug,
              id: values[f.id] as number,
              overrideAccess: false,
              req,
            })
            if (f.kind === 'media') media[f.id] = related as MediaFacts[string]
          }
        if (publishing) {
          const issues = evaluateFieldRules(fields, values, media)
          if (issues.length)
            throw new ValidationError({
              errors: issues.map((issue) => ({
                path: `postTypeValues.${issue.field}`,
                message: issue.message,
              })),
            })
        }
        const selected = refID(
          'designTemplate' in data ? data.designTemplate : originalDoc?.designTemplate,
        )
        if (
          selected &&
          !((type.templates || []) as unknown[]).some(
            (id) => String(refID(id)) === String(selected),
          )
        )
          throw new Error('This Template is not allowed for the selected Post Type')
        return { ...data, postType: type.id, postTypeValues: values }
      },
      ...(posts.hooks?.beforeValidate || []),
    ],
    afterChange: [
      ...(posts.hooks?.afterChange || []),
      async ({ doc, req }) => {
        if (req.context.skipEventIndex) return doc
        const existing = await req.payload.find({
          collection: 'event-series' as CollectionSlug,
          where: { post: { equals: doc.id } },
          limit: 1,
          overrideAccess: true,
          req,
        })
        // Draft writes return the draft document. Index the published row instead,
        // so an unpublished schedule never changes public calendar results.
        const published = await req.payload.find({
          collection: 'posts',
          where: { and: [{ id: { equals: doc.id } }, { _status: { equals: 'published' } }] },
          draft: false,
          depth: 0,
          limit: 1,
          overrideAccess: true,
          req,
        })
        const live = published.docs[0]
        const type = live && (await publishedType(req.payload, live.postType, req))
        const field = ((type?.fieldDefinitions || []) as TypeField[]).find(
          (f) => f.kind === 'eventSchedule',
        )
        const schedule =
          field &&
          ((live?.postTypeValues as Record<string, unknown> | undefined)?.[field.id] as
            EventSchedule | undefined)
        if (!live || type?.capability !== 'event' || !schedule) {
          if (existing.docs[0])
            await req.payload.delete({
              collection: 'event-series' as CollectionSlug,
              id: existing.docs[0].id,
              overrideAccess: true,
              req,
            })
        } else {
          const data = {
            post: doc.id,
            start: new Date(
              Math.min(
                eventInstant(schedule.start, schedule.timezone),
                ...(schedule.exceptions || [])
                  .filter((item) => item.start)
                  .map((item) => eventInstant(item.start!, schedule.timezone)),
              ),
            ).toISOString(),
            end: new Date(
              Math.max(
                eventInstant(schedule.end, schedule.timezone),
                ...(schedule.exceptions || [])
                  .filter((item) => item.end)
                  .map((item) => eventInstant(item.end!, schedule.timezone)),
              ),
            ).toISOString(),
            recurring: !!schedule.frequency && schedule.frequency !== 'none',
            schedule,
          }
          if (existing.docs[0])
            await req.payload.update({
              collection: 'event-series' as CollectionSlug,
              id: existing.docs[0].id,
              data,
              overrideAccess: true,
              req,
            })
          else
            await req.payload.create({
              collection: 'event-series' as CollectionSlug,
              data,
              overrideAccess: true,
              req,
            })
        }
        return doc
      },
    ],
    afterRead: [
      ...(posts.hooks?.afterRead || []),
      async ({ doc, req }) => {
        if (req.user || !doc.postTypeValues) return doc
        const type = await publishedType(req.payload, doc.postType, req)
        const allowed = new Set(
          ((type?.fieldDefinitions || []) as TypeField[]).filter((f) => f.public).map((f) => f.id),
        )
        doc.postTypeValues = Object.fromEntries(
          Object.entries(doc.postTypeValues).filter(([key]) => allowed.has(key)),
        )
        return doc
      },
    ],
    beforeDelete: [
      ...(posts.hooks?.beforeDelete || []),
      async ({ id, req }) => {
        await req.payload.delete({
          collection: 'event-series' as CollectionSlug,
          where: { post: { equals: id } },
          overrideAccess: true,
          req,
        })
      },
    ],
  }
  return config
}
