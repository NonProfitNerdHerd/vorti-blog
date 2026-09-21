/* eslint-disable @next/next/no-img-element */
import { createRendererRegistry } from '@design-system/payload-design-core'
import { HeroBoardRenderer } from '@design-system/payload-design-core/hero-board'
import { RichText } from '@payloadcms/richtext-lexical/react'
import type { PostDesignSection } from '@/lib/post-design'

const renderers = createRendererRegistry({ 'hero-board': HeroBoardRenderer })
export function PostDesignSections({ sections }: { sections: PostDesignSection[] }) { return <>{sections.map((section) => {
  if (section.kind === 'block') { const Renderer = renderers.get(section.rendererKey as 'hero-board'); return <Renderer key={section.key} design={section.design} values={section.values} headingLevel={2} /> }
  if (section.kind === 'field') { if (section.value == null || section.value === '') return null; if (section.fieldType === 'richText' && typeof section.value === 'object' && section.value && 'root' in section.value) return <div key={section.key} className="template-field template-field--richText"><RichText data={section.value as never} className="rich-text" /></div>; if (section.fieldType === 'image' && typeof section.value === 'object' && section.value && 'url' in section.value) return <img key={section.key} className="template-field template-field--image" src={String((section.value as { url: unknown }).url)} alt={String((section.value as { alt?: unknown }).alt ?? section.label)} />; if (section.fieldType === 'images' && Array.isArray(section.value)) return <div key={section.key} className="template-gallery">{section.value.map((value, i) => typeof value === 'object' && value && 'url' in value ? <img key={i} src={String((value as { url: unknown }).url)} alt={String((value as { alt?: unknown }).alt ?? '')} /> : null)}</div>; if (section.fieldType === 'shortText') return <h2 key={section.key} className="template-field template-field--shortText">{String(section.value)}</h2>; return <p key={section.key} className={`template-field template-field--${section.fieldType}`}>{String(section.value)}</p> }
  if (section.layout === 'divider') return <hr key={section.key} />
  if (section.layout === 'spacer') return <div key={section.key} aria-hidden="true" style={{ minHeight: '2rem' }} />
  if (section.layout === 'columns') return <div key={section.key} className="template-columns" style={{ display: 'grid', gridTemplateColumns: section.columns?.map((column) => `${column.width}fr`).join(' '), gap: '1rem' }}>{section.columns?.map((column) => <div key={column.id}><PostDesignSections sections={column.children} /></div>)}</div>
  return <div key={section.key} className={`template-layout template-layout--${section.layout}`}><PostDesignSections sections={section.children ?? []} /></div>
})}</> }
