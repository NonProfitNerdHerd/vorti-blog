/* eslint-disable @next/next/no-img-element */
import React, { type CSSProperties, type ReactNode } from 'react'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { HeroBoardRenderer } from '../hero-board/HeroBoard'
import type { HeroBoardValues } from '../hero-board/HeroBoard'
import { resolveStyle, safeURL, validStyleValue, type ContentNode, type Viewport } from './model'

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
}: {
  node: ContentNode
  children?: ReactNode
  body?: ReactNode
  viewport?: Viewport
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
            <RichText data={node.richText as never} />
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
    }
  if (
    node.kind !== 'richText' &&
    node.richText &&
    typeof node.richText === 'object' &&
    'root' in node.richText &&
    ['heading', 'paragraph', 'list', 'quote'].includes(node.kind)
  )
    content = <RichText data={node.richText as never} />
  return (
    <div
      className={`content-block ${className}`}
      id={node.anchor}
      data-block-kind={node.kind}
      style={viewport ? { ...base, ...styles } : undefined}
    >
      {!viewport && (
        <style>{`.${className}{${declarations(node, 'desktop', base)}}@media(max-width:1024px){.${className}{${declarations(node, 'tablet', base)}}}@media(max-width:640px){.${className}{${declarations(node, 'mobile', base)}}}`}</style>
      )}
      {body ?? content}
    </div>
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
          {node.children && <ContentRenderer nodes={node.children} viewport={viewport} />}
        </ContentBlock>
      ))}
    </>
  )
}
