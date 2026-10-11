import React, { lazy, Suspense, type ReactNode } from 'react'
import type { ContentNode } from '../content/model'
import { safeURL } from '../content/model'
import { getBlockDefinition } from './registry'
const Listing = lazy(() => import('./Listing'))
const ListingNavigation = lazy(() =>
  import('./Listing').then((module) => ({ default: module.ListingNavigation })),
)
const InteractiveBlock = lazy(() => import('./InteractiveBlock'))
export const blockIcons: Record<string, string> = {
  check: '✓',
  star: '★',
  arrow: '→',
  heart: '♥',
  info: 'ⓘ',
  location: '⌖',
  mail: '✉',
  phone: '☎',
  plus: '+',
  minus: '−',
}
export function CatalogRenderer({
  node,
  children,
  editing,
}: {
  node: ContentNode
  children?: ReactNode
  editing?: boolean
}) {
  const props = node.props ?? {},
    text = (key: string, fallback = '') => String(props[key] ?? fallback)
  const definition = getBlockDefinition(node.kind)
  if (definition?.render) return <>{definition.render(node, children)}</>
  if (
    [
      'accordion',
      'tabs',
      'carousel',
      'expand',
      'notification',
      'countUp',
      'countdown',
      'videoPopup',
    ].includes(node.kind)
  )
    return (
      <Suspense fallback={<div>{children}</div>}>
        <InteractiveBlock node={node} editing={editing}>
          {children}
        </InteractiveBlock>
      </Suspense>
    )
  const icon = <span aria-hidden="true">{blockIcons[text('icon', 'star')] ?? '★'}</span>
  switch (node.kind) {
    case 'icon':
      return (
        <span role={text('label') ? 'img' : undefined} aria-label={text('label') || undefined}>
          {icon}
        </span>
      )
    case 'iconButton':
      return (
        <a href={safeURL(props.url)} aria-label={text('label', 'Learn more')}>
          {icon}
        </a>
      )
    case 'iconLabel':
      return (
        <span>
          {icon} {text('label')}
        </span>
      )
    case 'iconList':
      return (
        <ul style={{ listStyle: 'none' }}>
          {text('items')
            .split('\n')
            .map((item, index) => (
              <li key={index}>
                {icon} {item}
              </li>
            ))}
        </ul>
      )
    case 'text':
    case 'subtitle':
      return <p style={{ whiteSpace: 'pre-wrap' }}>{text('text')}</p>
    case 'horizontalScroller':
      return (
        <div
          tabIndex={0}
          aria-label="Scrollable content"
          style={{ display: 'flex', overflowX: 'auto', gap: '1rem' }}
        >
          {children}
        </div>
      )
    case 'progressBar':
    case 'progressCircle': {
      const max = Math.max(1, Number(props.max ?? 100)),
        value = Math.min(max, Math.max(0, Number(props.value ?? 60)))
      return (
        <div>
          <span>{text('label', 'Progress')}</span>
          {node.kind === 'progressBar' ? (
            <progress max={max} value={value} aria-label={text('label', 'Progress')} />
          ) : (
            <svg
              viewBox="0 0 100 100"
              width="120"
              role="progressbar"
              aria-valuenow={value}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-label={text('label', 'Progress')}
            >
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                opacity=".15"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                pathLength="100"
                strokeDasharray={`${(value / max) * 100} 100`}
                transform="rotate(-90 50 50)"
              />
              <text x="50" y="55" textAnchor="middle">
                {Math.round((value / max) * 100)}%
              </text>
            </svg>
          )}
        </div>
      )
    }
    case 'numberBox':
      return (
        <div>
          <strong>{text('value', '1')}</strong>
          <p>{text('label')}</p>
        </div>
      )
    case 'price':
      return (
        <p>
          <span>{text('currency', '$')}</span>
          <strong>{text('value', '29')}</strong>
          <small>{text('period')}</small>
        </p>
      )
    case 'separator':
      return (
        <svg
          viewBox="0 0 100 12"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{
            width: '100%',
            height: '48px',
            transform: props.flip ? 'rotate(180deg)' : undefined,
          }}
        >
          <path
            fill="currentColor"
            d={
              props.shape === 'angle'
                ? 'M0 12 L100 0 L100 12 Z'
                : props.shape === 'curve'
                  ? 'M0 0 Q50 24 100 0 V12 H0Z'
                  : 'M0 6 Q25 0 50 6 T100 6 V12 H0Z'
            }
          />
        </svg>
      )
    case 'socialButtons':
      return (
        <nav aria-label="Social links">
          {text('links')
            .split('\n')
            .filter(Boolean)
            .map((line, index) => {
              const [label, href] = line.split('|').map((value) => value.trim())
              return (
                <a
                  key={index}
                  href={safeURL(href)}
                  rel="noopener noreferrer"
                  style={{ marginInlineEnd: '1rem' }}
                >
                  {label}
                </a>
              )
            })}
        </nav>
      )
    case 'map': {
      const latitude = Math.max(-85, Math.min(85, Number(props.latitude ?? 44.5))),
        longitude = Math.max(-180, Math.min(180, Number(props.longitude ?? -89.5))),
        delta = 180 / 2 ** Math.max(1, Math.min(18, Number(props.zoom ?? 10)))
      const params = new URLSearchParams({
        bbox: `${longitude - delta},${latitude - delta},${longitude + delta},${latitude + delta}`,
        layer: 'mapnik',
        ...(props.marker === false ? {} : { marker: `${latitude},${longitude}` }),
      })
      return (
        <figure>
          <iframe
            title="Location map"
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?${params}`}
            style={{ width: '100%', minHeight: '320px', border: 0 }}
          />
          <figcaption>
            <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>
          </figcaption>
        </figure>
      )
    }
    case 'tableOfContents':
      return (
        <nav aria-label="Table of contents">
          {(Array.isArray(props.headings) ? props.headings : []).map((raw, index) => {
            const heading = raw as { id: string; text: string; level: number }
            return (
              <div
                key={index}
                style={{ paddingInlineStart: `${Math.max(0, heading.level - 2)}rem` }}
              >
                <a href={`#${heading.id}`}>{heading.text}</a>
              </div>
            )
          })}
        </nav>
      )
    case 'postListing':
      return (
        <Suspense fallback={<p>Loading listing?</p>}>
          <Listing node={node} editing={editing} />
        </Suspense>
      )
    case 'pagination':
    case 'loadMore':
      return (
        <Suspense fallback={null}>
          <ListingNavigation node={node} editing={editing} />
        </Suspense>
      )
    default:
      return definition?.container ? (
        <>{children}</>
      ) : (
        <p role="alert">
          Block “{node.kind}” is unavailable. Restore its registered definition to edit it; its
          saved data is retained.
        </p>
      )
  }
}
