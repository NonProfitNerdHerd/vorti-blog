import type { Plugin, CollectionSlug } from 'payload'
import { refID } from './collections'
import { validateValues } from './validation'
import { eventFields } from './event-fields'
import {
  eventInstant,
  type EventSchedule,
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
          const templateID = refID(document.designTemplate)
          if (templateID) {
            const template = document.templateSnapshot?.template ?? await req.payload.findByID({
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
  const posts = config.collections?.find(c => c.slug === 'posts')
  if (!posts) return config
  posts.fields.push({ name: 'event', type: 'json', admin: { components: { Field: './content-framework/EventField#EventField' } } })
  posts.hooks = {
    ...posts.hooks,
    beforeOperation: [...(posts.hooks?.beforeOperation ?? []), ({ args, operation }) => {
      if (operation === 'create' || operation === 'update') args.req.context.savingContentDraft = 'draft' in args && args.draft === true
      return args
    }],
    beforeValidate: [...(posts.hooks?.beforeValidate ?? []), async ({ data, originalDoc, req }) => {
      const event = data && 'event' in data ? data.event : originalDoc?.event
      if (event?.schedule) {
        if (!event.schedule.timezone) {
          const site = await req.payload.findGlobal({ slug: 'site-settings', depth: 0, req })
          event.schedule.timezone = originalDoc?.event?.schedule?.timezone || site.timezone || 'UTC'
        }
      }
      if (event != null) validateValues(eventFields, event, req.context.savingContentDraft !== true && (data?._status ?? originalDoc?._status) === 'published')
      return data
    }],
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
        const schedule = (live?.event as { schedule?: EventSchedule } | undefined)?.schedule
        if (!live || !schedule) {
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
