import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Post } from '@/payload-types'
import { createPayloadDesignStore, resolveContentTemplate } from '@design-system/payload-design-core'
import type { HeroBoardValues } from '@design-system/payload-design-core/hero-board'
import { mediaURL } from './media'

export type PostDesignSection = {
  key: string
  rendererKey: string
  design: Record<string, unknown>
  values: HeroBoardValues
}

export async function resolvePostDesign(post: Post): Promise<PostDesignSection[]> {
  const reference = post.designTemplate
  const template = typeof reference === 'object' && reference !== null ? reference.id : reference as string | number | undefined
  if (!template) return []
  const payload = await getPayload({ config })
  const values = (post.templateValues ?? {}) as Record<string, Record<string, unknown>>
  const pendingOverrides = (values.__designOverrides ?? {}) as Record<string, string | number | null>
  const resolved = await resolveContentTemplate(createPayloadDesignStore(payload), {
    id: post.id,
    template,
    templateValues: values,
    designOverrides: { ...((post.designOverrides ?? {}) as Record<string, string | number | null>), ...pendingOverrides },
  })
  return Promise.all(resolved.sections.map(async (section) => {
    const values = { ...section.values } as Record<string, unknown>
    for (const key of ['backgroundImage', 'foregroundImage']) {
      const reference = values[key]
      if (!reference) continue
      try {
        const media = typeof reference === 'object' && reference !== null ? reference : await payload.findByID({ collection: 'media', id: Number(reference), depth: 0, overrideAccess: false })
        values[key] = { url: mediaURL(media as never) ?? '', alt: (media as { alt?: string }).alt ?? '' }
      } catch { delete values[key] }
    }
    return { key: section.key, rendererKey: section.blockType.rendererKey,
      design: section.blockDesign.design, values: values as HeroBoardValues }
  }))
}
