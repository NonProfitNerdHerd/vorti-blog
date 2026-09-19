import { createRendererRegistry } from '@design-system/payload-design-core'
import { HeroBoardRenderer } from '@design-system/payload-design-core/hero-board'
import type { PostDesignSection } from '@/lib/post-design'

const renderers = createRendererRegistry({ 'hero-board': HeroBoardRenderer })

export function PostDesignSections({ sections }: { sections: PostDesignSection[] }) {
  return <>{sections.map((section) => {
    const Renderer = renderers.get(section.rendererKey as 'hero-board')
    return <Renderer key={section.key} design={section.design} values={section.values} headingLevel={2} />
  })}</>
}
