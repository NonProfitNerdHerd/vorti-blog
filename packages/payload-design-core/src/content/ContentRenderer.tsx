/* eslint-disable @next/next/no-img-element */
import React, { type CSSProperties, type ReactNode } from 'react'
import { RichText, type JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import { HeroBoardRenderer } from '../hero-board/HeroBoard'
import type { HeroBoardValues } from '../hero-board/HeroBoard'
import { resolveStyle, safeURL, validStyleValue, type ContentNode, type Viewport } from './model'
import { CatalogRenderer } from '../blocks/CatalogRenderer'
import { getBlockDefinition } from '../blocks/registry'
import { compileBlockCSS, conditionVisible, validatePresentation } from '../blocks/presentation'
const Motion = React.lazy(() => import('../blocks/Motion'))
const InteractiveBlock = React.lazy(() => import('../blocks/InteractiveBlock'))

const mediaInfo = (value: unknown): { url?: string; alt?: string } =>
  value && typeof value === 'object' ? (value as { url?: string; alt?: string }) : {}
function declarations(node: ContentNode, viewport: Viewport, base: CSSProperties = {}) {
  const style = resolveStyle(node.styles, viewport)
  return (
    (style.borderWidth ? 'border-style:solid;' : '') +
    Object.entries({
      ...base,
      ...Object.fromEntries(
        Object.entries(style).filter(([key, value]) => validStyleValue(key, value)),
      ),
    })
      .map(
        ([key, value]) => `${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}:${value}`,
      )
      .join(';')
  )
}
export function ContentBlock({
  node,
  children,
  body,
  viewport,
  document = {},
}: {
  node: ContentNode
  children?: ReactNode
  body?: ReactNode
  viewport?: Viewport
  document?: Record<string, unknown>
}) {
  const className = `content-block-${node.id.replace(/[^\w-]/g, '')}`
  const base: CSSProperties =
    node.kind === 'columns'
      ? {
          display: 'grid',
          gridTemplateColumns: (node.children ?? []).map(() => '1fr').join(' '),
          gap: '16px',
        }
      : node.kind === 'row'
        ? { display: 'flex', flexWrap: 'wrap', gap: '16px' }
        : {}
  const styles = Object.fromEntries(
    Object.entries(resolveStyle(node.styles, viewport)).filter(([key, value]) =>
      validStyleValue(key, value),
    ),
  ) as CSSProperties
  if (styles.borderWidth) styles.borderStyle = 'solid'
  let headingIndex = 0
  const converters: JSXConvertersFunction = ({ defaultConverters }) => ({
    ...defaultConverters,
    heading: ({ node: heading, nodesToJSX }) =>
      React.createElement(
        /^h[1-6]$/.test(heading.tag) ? heading.tag : 'h2',
        { id: `heading-${node.id}-${++headingIndex}` },
        nodesToJSX({ nodes: heading.children }),
      ),
  })
  let content: ReactNode = children
  const media = mediaInfo(node.media)
  if (!children)
    switch (node.kind) {
      case 'heading':
        content = React.createElement(`h${node.level ?? 2}`, {}, node.text)
        break
      case 'paragraph':
        content = <p style={{ whiteSpace: 'pre-wrap' }}>{node.text}</p>
        break
      case 'richText':
        content =
          node.richText && typeof node.richText === 'object' && 'root' in node.richText ? (
            <RichText data={node.richText as never} converters={converters} />
          ) : null
        break
      case 'list': {
        const items = (node.text ?? '')
          .split('\n')
          .map((text, index) => <li key={index}>{text}</li>)
        content = node.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
        break
      }
      case 'quote':
        content = <blockquote style={{ whiteSpace: 'pre-wrap' }}>{node.text}</blockquote>
        break
      case 'image':
        content = media.url ? (
          <figure>
            <img
              src={safeURL(media.url)}
              alt={node.alt ?? media.alt ?? ''}
              style={{ maxWidth: '100%' }}
            />
            {node.text && <figcaption>{node.text}</figcaption>}
          </figure>
        ) : null
        break
      case 'gallery':
        content = (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
            {(Array.isArray(node.media) ? node.media : []).map((item, index) => {
              const image = mediaInfo(item)
              return image.url ? (
                <img
                  key={index}
                  src={safeURL(image.url)}
                  alt={image.alt ?? ''}
                  style={{ maxWidth: '100%', width: '240px', objectFit: 'cover' }}
                />
              ) : null
            })}
          </div>
        )
        break
      case 'button':
        content = (
          <a className="content-button" href={safeURL(node.url)}>
            {node.text || 'Link'}
          </a>
        )
        break
      case 'video':
        content = safeURL(node.url) ? (
          <video
            controls
            src={safeURL(node.url)}
            style={{ maxWidth: '100%' }}
            aria-label={node.text || 'Video'}
          />
        ) : null
        break
      case 'divider':
        content = <hr />
        break
      case 'spacer':
        content = <span aria-hidden="true" />
        break
      case 'value':
        content = <span>{node.text}</span>
        break
      case 'designed':
        content =
          node.rendererKey === 'hero-board' ? (
            <HeroBoardRenderer
              design={node.design ?? {}}
              values={(node.values ?? {}) as HeroBoardValues}
              headingLevel={2}
            />
          ) : (
            <p role="alert">This block’s renderer is unavailable. Ask a designer to restore it.</p>
          )
        break
      default:
        content = <CatalogRenderer node={node} editing={!!viewport} />
    }
  if (
    children &&
    getBlockDefinition(node.kind)?.container &&
    !['group', 'row', 'columns', 'column'].includes(node.kind)
  )
    content = (
      <CatalogRenderer node={node} editing={!!viewport}>
        {children}
      </CatalogRenderer>
    )
  if (
    node.kind !== 'richText' &&
    node.richText &&
    typeof node.richText === 'object' &&
    'root' in node.richText &&
    ['heading', 'paragraph', 'list', 'quote'].includes(node.kind)
  )
    content = <RichText data={node.richText as never} converters={converters} />
  const definition = getBlockDefinition(node.kind)
  if (definition && (node.blockVersion ?? 1) > definition.version)
    content = (
      <p role="alert">
        This block was saved with a newer version. Update its registered definition to edit it; its
        saved data is retained.
      </p>
    )
  else if (!definition && !['value', 'designed'].includes(node.kind) && children)
    content = (
      <>
        <p role="alert">
          Block ?{node.kind}? is unavailable. Restore its registered definition; its saved data is
          retained.
        </p>
        {children}
      </>
    )
  const presentation = validatePresentation(node.presentation) ? {} : (node.presentation ?? {})
  const Tag = presentation.tag ?? 'div'
  const background = presentation.background
  const overlay = background?.overlay ?? '#000000'
  const overlayColor = `${overlay}${Math.round((background?.opacity ?? 0) * 255)
    .toString(16)
    .padStart(2, '0')}`
  const backgroundStyle: CSSProperties = background?.imageURL
    ? {
        backgroundImage: `linear-gradient(${overlayColor},${overlayColor}),url("${background.imageURL}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : {}
  const css = compileBlockCSS(presentation.css, `.${className}`)
  const stateRule = (state: 'hover' | 'focus') =>
    `.${className}:${state === 'focus' ? 'focus-within' : 'hover'}{${Object.entries(
      presentation[state] ?? {},
    )
      .filter(([key, value]) => validStyleValue(key, value))
      .map(
        ([key, value]) => `${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${value}`,
      )
      .join(';')}}`
  let rendered = body ?? content
  if (presentation.link?.lightbox)
    rendered = (
      <React.Suspense fallback={rendered}>
        <InteractiveBlock node={node} editing={!!viewport}>
          {rendered}
        </InteractiveBlock>
      </React.Suspense>
    )
  else if (safeURL(presentation.link?.url))
    rendered = (
      <a
        href={safeURL(presentation.link?.url)}
        target={presentation.link?.newTab ? '_blank' : undefined}
        rel={presentation.link?.newTab ? 'noopener noreferrer' : presentation.link?.rel}
        title={presentation.link?.title}
      >
        {rendered}
      </a>
    )
  const imageRule = (device: Viewport) => {
    const resolved = resolveStyle(node.styles, device)
    return `.${className} > figure > img{width:100%;object-fit:${resolved.objectFit ?? 'cover'};object-position:${resolved.objectPosition ?? '50% 50%'};aspect-ratio:${resolved.aspectRatio ?? 'auto'}}`
  }
  const imageCSS = viewport
    ? imageRule(viewport)
    : `${imageRule('desktop')}@media(max-width:1024px){${imageRule('tablet')}}@media(max-width:640px){${imageRule('mobile')}}`
  return (
    <Tag
      {...presentation.attributes}
      className={`content-block ${className} ${presentation.className ?? ''}`}
      id={node.anchor}
      data-motion-id={node.id}
      data-block-kind={node.kind}
      style={viewport ? { ...base, ...styles, ...backgroundStyle } : backgroundStyle}
    >
      {!viewport && (
        <style>{`.${className}{${declarations(node, 'desktop', base)}}@media(max-width:1024px){.${className}{${declarations(node, 'tablet', base)}}}@media(max-width:640px){.${className}{${declarations(node, 'mobile', base)}}}`}</style>
      )}
      <style>{`${css}${stateRule('hover')}${stateRule('focus')}${imageCSS}${!viewport ? (['desktop', 'tablet', 'mobile'] as const).map((device) => (presentation.hidden?.[device] ? `@media ${device === 'desktop' ? '(min-width:1025px)' : device === 'tablet' ? '(min-width:641px) and (max-width:1024px)' : '(max-width:640px)'}{.${className}{display:none}}` : '')).join('') : ''}`}</style>
      {viewport && presentation.hidden?.[viewport] && (
        <p role="status">Hidden on {viewport} in published content.</p>
      )}
      {viewport && !conditionVisible(presentation.condition, document) && (
        <p role="status">Hidden by display conditions for this preview document.</p>
      )}
      {!viewport && presentation.motion && (
        <React.Suspense fallback={null}>
          <Motion id={node.id} motion={presentation.motion} />
        </React.Suspense>
      )}
      {rendered}
    </Tag>
  )
}
export function ContentRenderer({
  nodes,
  viewport,
}: {
  nodes: ContentNode[]
  viewport?: Viewport
}) {
  return (
    <>
      {nodes.map((node) => (
        <ContentBlock key={node.id} node={node} viewport={viewport}>
          {node.children?.map((child) => (
            <ContentRenderer key={child.id} nodes={[child]} viewport={viewport} />
          ))}
        </ContentBlock>
      ))}
    </>
  )
}
