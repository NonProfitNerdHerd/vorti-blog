import { isViewPlacement } from '../views/model'
import React, { lazy, Suspense, type ReactNode } from 'react'
import type { ContentNode } from '../content/model'
import { safeURL } from '../content/model'
import { getBlockDefinition } from './registry'
import { BlockIcon } from './Icons'
import { Separator } from './Separator'
import { blockItems } from './items'
import { DynamicView } from '../views/DynamicView'
import type { ViewResult } from '../views/model'
import { Menu } from '../menus/Menu'
import type { ResolvedMenu } from '../menus/model'
const Listing = lazy(() => import('./Listing'))
const FormPlacement = lazy(() => import('../forms/FormPlacement').then(module => ({ default: module.FormPlacement })))
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
  viewport,
}: {
  node: ContentNode
  children?: ReactNode
  editing?: boolean
  viewport?: 'desktop' | 'tablet' | 'mobile'
}) {
  const props = node.props ?? {},
    text = (key: string, fallback = '') => String(props[key] ?? fallback)
  const definition = getBlockDefinition(node.kind)
  if (node.kind === 'menu') return <Menu menuID={text('menuID')} initial={props.resolvedMenu as ResolvedMenu | null | undefined} editing={editing} depth={Math.max(1, Math.min(5, Number(props.depth) || 5))} orientation={text('orientation', 'horizontal')} alignment={text('alignment', 'start')} gap={text('gap', '1rem')} mobile={text('mobile', 'collapse')} label={text('label', 'Navigation')} submenuBackground={text('submenuBackground', '#ffffff')} submenuColor={text('submenuColor', '#1a1a1a')} submenuPadding={text('submenuPadding', '.5rem')} submenuBorder={text('submenuBorder', '1px solid #8884')} submenuRadius={text('submenuRadius', '8px')} hoverColor={text('hoverColor', '#4f46e5')} activeColor={text('activeColor', '#4f46e5')} />
  if (node.kind === 'form') return <Suspense fallback={<p>Loading form…</p>}><FormPlacement formID={text('formID')} editing={editing} /></Suspense>
  if(isViewPlacement(node.kind)) return !props.viewID && editing
    ? <div role="status"><strong>{definition?.label}</strong><p>Select this block to set up its content filters in the inspector, or choose an existing Saved View.</p></div>
    : <DynamicView viewID={text('viewID')} initial={props.resolvedView as ViewResult|undefined} editing={editing}/>
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
        <InteractiveBlock node={node} editing={editing} viewport={viewport}>
          {children}
        </InteractiveBlock>
      </Suspense>
    )
  const icon = <BlockIcon name={text('icon', 'star')} />
  switch (node.kind) {
    case 'icon':
      return (
        <span role={text('label') ? 'img' : undefined} aria-label={text('label') || undefined}>
          {icon}
        </span>
      )
    case 'iconButton':
      return (
        <a
          className="icon-button"
          href={safeURL(props.url)}
          aria-label={text('label', 'Learn more')}
        >
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
        <ul
          style={{
            listStyle: 'none',
            columnCount: Number(props.columns ?? 1),
            paddingInlineStart:
              props.indent !== undefined ? `${Number(props.indent)}px` : undefined,
          }}
        >
          {blockItems(props.items).map((item, index) => (
            <li
              key={index}
              style={{
                breakInside: 'avoid',
                marginBottom:
                  props.itemGap !== undefined ? `${Number(props.itemGap)}px` : undefined,
              }}
            >
              <BlockIcon name={item.icon ?? text('icon', 'check')} />{' '}
              {item.url ? <a href={safeURL(item.url)}>{item.label}</a> : item.label}
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
          className="block-horizontal-scroller"
          tabIndex={0}
          aria-label="Scrollable content"
          style={{
            display: 'flex',
            overflowX: 'auto',
            gap: props.gap !== undefined ? `${Number(props.gap)}px` : '1rem',
            scrollSnapType: props.snap ? 'x mandatory' : undefined,
            scrollbarWidth: props.scrollbar === false ? 'none' : undefined,
          }}
        >
          {props.columns
            ? React.Children.map(children, (child) => (
                <div
                  style={{
                    flex: `0 0 calc((100% - ${Math.max(0, Number(props.columns) - 1) * Number(props.gap ?? 24)}px) / ${Math.max(1, Number(props.columns))})`,
                    scrollSnapAlign: 'start',
                    minWidth: 0,
                  }}
                >
                  {child}
                </div>
              ))
            : children}
        </div>
      )
    case 'progressBar':
    case 'progressCircle': {
      const max = Math.max(1, Number(props.max ?? 100)),
        value = Math.min(max, Math.max(0, Number(props.value ?? 60)))
      return (
        <div>
          <span className="progress-label">{text('label', 'Progress')}</span>
          {node.kind === 'progressBar' && props.thickness === undefined ? (
            <progress max={max} value={value} aria-label={text('label', 'Progress')} />
          ) : node.kind === 'progressBar' ? (
            <div
              className="progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={value}
              aria-label={text('label', 'Progress')}
              style={{ borderRadius: props.rounded ? '999px' : 0, overflow: 'hidden' }}
            >
              <div
                className="progress-fill"
                style={{
                  width: `${(value / max) * 100}%`,
                  height: `${Number(props.thickness ?? 16)}px`,
                }}
              />
            </div>
          ) : (
            <svg
              viewBox="0 0 100 100"
              width={Number(props.size ?? 120)}
              role="progressbar"
              aria-valuenow={value}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-label={text('label', 'Progress')}
            >
              <circle
                className="progress-track"
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth={Number(props.thickness ?? 8)}
                opacity=".15"
              />
              <circle
                className="progress-fill"
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth={Number(props.thickness ?? 8)}
                strokeLinecap={props.rounded ? 'round' : 'butt'}
                pathLength="100"
                strokeDasharray={`${(value / max) * 100} 100`}
                transform="rotate(-90 50 50)"
              />
              <text className="progress-label" x="50" y="55" textAnchor="middle">
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
          <strong
            className="number-badge"
            data-shape={props.shape}
            style={
              props.shape && props.shape !== 'none'
                ? {
                    display: 'inline-grid',
                    placeItems: 'center',
                    width: `${Number(props.size ?? 64)}px`,
                    height: `${Number(props.size ?? 64)}px`,
                    border: '2px solid currentColor',
                    borderRadius:
                      props.shape === 'circle'
                        ? '50%'
                        : props.shape === 'rounded'
                          ? '16px'
                          : undefined,
                    transform: props.shape === 'diamond' ? 'rotate(45deg)' : undefined,
                  }
                : undefined
            }
          >
            <span style={{ transform: props.shape === 'diamond' ? 'rotate(-45deg)' : undefined }}>
              {text('value', '1')}
            </span>
          </strong>
          <p className="number-label">{text('label')}</p>
        </div>
      )
    case 'price':
      return (
        <p>
          <span className="price-currency">{text('currency', '$')}</span>
          <strong className="price-amount">{text('value', '29')}</strong>
          <small className="price-period">{text('period')}</small>
        </p>
      )
    case 'separator':
      return (
        <Separator
          settings={{
            shape: text('shape', 'wave'),
            height: Number(props.height ?? 48),
            width: Number(props.width ?? 100),
            layers: Number(props.layers ?? 1),
            flip: !!props.flip,
            shadow: !!props.shadow,
          }}
        />
      )
    case 'socialButtons':
      return (
        <nav aria-label="Social links">
          {blockItems(props.links, true).map((item, index) => {
            return (
              <a
                key={index}
                className="social-button"
                href={safeURL(item.url)}
                rel="noopener noreferrer"
                style={{ marginInlineEnd: '1rem' }}
              >
                {item.icon && <BlockIcon name={item.icon} />} {item.label}
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
        <nav aria-label="Table of contents" style={{ columnCount: Number(props.columns ?? 1) }}>
          {(!Array.isArray(props.headings) || !props.headings.length) && (
            <p>
              Add Heading blocks to this document to build a table of contents. Check the selected
              heading levels if headings are missing.
            </p>
          )}
          {(Array.isArray(props.headings) ? props.headings : []).map((raw, index) => {
            const heading = raw as { id: string; text: string; level: number }
            return (
              <div
                key={index}
                style={{
                  paddingInlineStart: `${Math.max(0, heading.level - Number(props.minLevel ?? 2))}rem`,
                  marginBottom: `${Number(props.itemGap ?? 0)}px`,
                  breakInside: 'avoid',
                }}
              >
                <a href={`#${heading.id}`}>
                  {props.numbered ? `${index + 1}. ` : ''}
                  {heading.text}
                </a>
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
