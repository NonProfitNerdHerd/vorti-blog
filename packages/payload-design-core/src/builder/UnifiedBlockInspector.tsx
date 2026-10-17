'use client'
import { isViewPlacement } from '../views/model'
import { useCategoriesEnabled } from '../categories'
import { ViewPlacementSetup } from '../views/ViewPlacementSetup'
import { BlockGlyph } from '../blocks/BlockGlyph'
import { SaveReusableView } from '../views/SaveReusableView'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getBlockDefinition } from '../blocks/registry'
import { IconPicker } from './IconPicker'
import { ItemsEditor } from './ItemsEditor'
import { BackgroundControls } from './BackgroundControls'
import { RepeatedItemsControl } from './RepeatedItemsControl'
import {
  publicDocumentFields,
  validatePresentation,
  type BlockPresentation,
  type Rule,
} from '../blocks/presentation'
import { resolveStyle, validStyleValue, type ContentNode, type Viewport } from '../content/model'
import {
  InspectorDevice,
  InspectorIcon,
  beginInspectorGesture,
  endInspectorGesture,
} from './InspectorControls'
import { VisualStyleControl, PaintControl, FocalPoint } from './VisualStyleControl'
import './block-inspector.css'
import { VariationPicker } from './VariationPicker'
import { effectiveStyles, resetLayoutStyles } from '../blocks/variations'
import { separatorPaths } from '../blocks/Separator'

const title = (key: string) =>
  key
    .replace(/[A-Z]/g, (char) => ` ${char.toLowerCase()}`)
    .replace(/^./, (char) => char.toUpperCase())
type InspectorTab = 'layout' | 'style' | 'advanced'
const InspectorTabContext = createContext<{
  tab: InspectorTab
  setTab: (tab: InspectorTab) => void
} | null>(null)
export function BlockInspectorStateProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<InspectorTab>('style')
  return (
    <InspectorTabContext.Provider value={{ tab, setTab }}>{children}</InspectorTabContext.Provider>
  )
}
const sections = {
  layout: {
    'Size and spacing': [
      'width',
      'minWidth',
      'maxWidth',
      'height',
      'minHeight',
      'maxHeight',
      'aspectRatio',
      'padding',
      'margin',
    ],
    Arrangement: [
      'display',
      'flexDirection',
      'flexWrap',
      'alignItems',
      'justifyContent',
      'gap',
      'gridTemplateColumns',
    ],
  },
  style: {
    Typography: [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'lineHeight',
      'letterSpacing',
      'textAlign',
      'textTransform',
      'color',
    ],
    Background: ['backgroundColor', 'backgroundImage'],
    'Borders and shadows': [
      'borderStyle',
      'borderWidth',
      'borderColor',
      'borderRadius',
      'boxShadow',
    ],
    Image: ['objectFit', 'objectPosition'],
  },
  advanced: {
    Position: ['position', 'top', 'right', 'bottom', 'left', 'zIndex', 'opacity', 'overflow'],
    'Transform and transition': ['transform', 'transition'],
  },
}
export function UnifiedBlockInspector({
  node,
  onChange,
  viewport: suppliedViewport,
  disabled,
  children,
  layoutControls,
  contentLabel = 'Content',
  bindingFields = [],
  showFields = true,
  renderBackgroundMedia,
  renderDocumentPicker,
  listings = [],
  activeTab,
  hideHeader = false,
}: {
  node: ContentNode
  listings?: Array<{ id: string; label: string }>
  renderDocumentPicker?: (
    collection: string,
    label: string,
    value: string,
    change: (value: string) => void,
  ) => ReactNode
  renderBackgroundMedia?: (
    value: BlockPresentation['background'],
    change: (value: NonNullable<BlockPresentation['background']>) => void,
  ) => ReactNode
  showFields?: boolean
  bindingFields?: Array<{ path: string; label: string }>
  onChange: (patch: Partial<ContentNode>) => void
  viewport?: Viewport
  disabled?: boolean
  children?: ReactNode
  layoutControls?: ReactNode
  contentLabel?: string
  activeTab?: InspectorTab
  hideHeader?: boolean
}) {
  const categoriesEnabled = useCategoriesEnabled()
  const [ownTab, setOwnTab] = useState<InspectorTab>('style')
  const sharedTab = useContext(InspectorTabContext)
  const tab = activeTab ?? sharedTab?.tab ?? ownTab,
    setTab = sharedTab?.setTab ?? setOwnTab
  const device: Viewport = 'desktop'
  const [state, setState] = useState<'normal' | 'hover' | 'focus'>('normal')
  const [error, setError] = useState('')
  const sharedDevice = useContext(InspectorDevice)
  const viewport = sharedDevice?.viewport ?? suppliedViewport ?? device
  const definition = getBlockDefinition(node.kind)
  const [selectedTarget, setSelectedTarget] = useState('block')
  const target = definition?.targets?.some((item) => item.id === selectedTarget)
    ? selectedTarget
    : 'block'
  useEffect(() => {
    const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-motion-id]')).filter(
      (element) => element.dataset.motionId === node.id,
    )
    blocks.forEach((element) => (element.dataset.inspectorTarget = target))
    return () => blocks.forEach((element) => delete element.dataset.inspectorTarget)
  }, [node.id, target])
  const authoredStyles = target === 'block' ? node.styles : node.targetStyles?.[target]
  const writeStyles = (next: typeof node.styles) =>
    target === 'block'
      ? onChange({ styles: next })
      : onChange({ targetStyles: { ...node.targetStyles, [target]: next ?? {} } })
  const presentation = node.presentation ?? {}
  const values =
    state === 'normal' ? (authoredStyles?.[viewport] ?? {}) : (presentation[state] ?? {})
  const inherited = resolveStyle(
    target === 'block' ? effectiveStyles(node) : authoredStyles,
    viewport,
  )
  const updatePresentation = (patch: Partial<BlockPresentation>) => {
    const next = { ...presentation, ...patch },
      problem = validatePresentation(next)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    onChange({ presentation: next })
  }
  const update = (key: string, value: string) => {
    if (value && !validStyleValue(key, value)) {
      setError(`Invalid ${title(key)} value.`)
      return
    }
    setError('')
    const next = { ...values }
    if (value) next[key] = value
    else delete next[key]
    if (state === 'normal') writeStyles({ ...authoredStyles, [viewport]: next })
    else updatePresentation({ [state]: next })
  }
  const condition = presentation.condition ?? { match: 'all' as const, rules: [] }
  const changeRule = (index: number, patch: Partial<Rule>) =>
    updatePresentation({
      condition: {
        ...condition,
        rules: condition.rules.map((rule, i) => (index === i ? { ...rule, ...patch } : rule)),
      },
    })
  return (
    <fieldset
      disabled={disabled}
      className="unified-block-inspector"
      onPointerDown={beginInspectorGesture}
      onPointerUp={endInspectorGesture}
      onPointerCancel={endInspectorGesture}
      onFocus={beginInspectorGesture}
      onBlur={endInspectorGesture}
    >
      {!hideHeader && (
        <div className="inspector-sticky">
          <header>
            <strong
              role="heading"
              aria-level={3}
              aria-label={definition?.label ?? node.label ?? node.kind}
            >
              {<BlockGlyph kind={node.kind} />} {definition?.label ?? node.label ?? node.kind}
            </strong>
            <p>{definition?.description ?? 'Block presentation settings.'}</p>
          </header>
          <div role="tablist" aria-label="Block controls">
            {(['layout', 'style', 'advanced'] as const).map((name) => (
              <button
                type="button"
                key={name}
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
              >
                <InspectorIcon name={name} />
                {title(name)}
              </button>
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      {!!definition?.targets?.length && (
        <label className="inspector-target-picker">
          Style target
          <select
            aria-label="Style target"
            value={target}
            onChange={(event) => {
              setSelectedTarget(event.target.value)
              setState('normal')
            }}
          >
            <option value="block">Block</option>
            {definition.targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {tab === 'layout' && layoutControls}
      {tab === 'layout' && <VariationPicker node={node} onChange={onChange} disabled={disabled} />}
      {tab === 'layout' && node.variation && (
        <button type="button" onClick={() => onChange({ styles: resetLayoutStyles(node) })}>
          Reset layout styling
        </button>
      )}
      {tab === 'style' &&
        target === 'block' &&
        !isViewPlacement(node.kind) &&
        node.kind !== 'form' && (
          <details open>
            <summary>{contentLabel}</summary>
            {children}
            <RepeatedItemsControl node={node} change={onChange} />
            {node.role === 'item' && (
              <>
                <label>
                  Entry date
                  <input
                    type="date"
                    value={String(node.props?.date ?? '')}
                    onChange={(event) =>
                      onChange({ props: { ...node.props, date: event.target.value } })
                    }
                  />
                </label>
                <label>
                  Marker label
                  <input
                    value={String(node.props?.marker ?? '')}
                    onChange={(event) =>
                      onChange({ props: { ...node.props, marker: event.target.value } })
                    }
                  />
                </label>
              </>
            )}
            {showFields &&
              definition?.fields
                .filter((field) => categoriesEnabled || field.key !== 'categories')
                .map((field) => {
                  const FieldLabel =
                    ['items', 'icon'].includes(field.type) ||
                    (node.kind === 'postListing' && ['ids', 'categories'].includes(field.key))
                      ? 'div'
                      : 'label'
                  return (
                    <div key={field.key}>
                      <FieldLabel>
                        {field.label}
                        {field.key === 'initialPanel' ? (
                          <select
                            value={String(
                              node.props?.initialPanel ?? (node.kind === 'accordion' ? -1 : 0),
                            )}
                            onChange={(event) =>
                              onChange({
                                props: { ...node.props, initialPanel: Number(event.target.value) },
                              })
                            }
                          >
                            {node.kind === 'accordion' && (
                              <option value="-1">All panels closed</option>
                            )}
                            {node.children?.map((child, index) => (
                              <option key={child.id} value={index}>
                                {child.label || 'Item ' + (index + 1)}
                              </option>
                            ))}
                          </select>
                        ) : field.key === 'listingID' ? (
                          <select
                            value={String(node.props?.listingID ?? '')}
                            onChange={(event) =>
                              onChange({ props: { ...node.props, listingID: event.target.value } })
                            }
                          >
                            <option value="">Choose a listing</option>
                            {listings.map((listing) => (
                              <option key={listing.id} value={listing.id}>
                                {listing.label}
                              </option>
                            ))}
                          </select>
                        ) : node.kind === 'postListing' &&
                          ['ids', 'categories'].includes(field.key) &&
                          renderDocumentPicker ? (
                          renderDocumentPicker(
                            field.key === 'categories'
                              ? 'categories'
                              : String(node.props?.collection ?? 'posts'),
                            field.key === 'categories' ? 'Categories' : 'Documents',
                            String(node.props?.[field.key] ?? ''),
                            (value) => onChange({ props: { ...node.props, [field.key]: value } }),
                          )
                        ) : field.type === 'toggle' ? (
                          <input
                            type="checkbox"
                            checked={Boolean(node.props?.[field.key])}
                            onChange={(event) =>
                              onChange({
                                props: { ...node.props, [field.key]: event.target.checked },
                              })
                            }
                          />
                        ) : field.type === 'items' ? (
                          <ItemsEditor
                            value={node.props?.[field.key]}
                            social={node.kind === 'socialButtons'}
                            change={(value) =>
                              onChange({ props: { ...node.props, [field.key]: value } })
                            }
                          />
                        ) : field.type === 'icon' ? (
                          <IconPicker
                            value={String(node.props?.[field.key] ?? field.defaultValue ?? 'star')}
                            change={(value) =>
                              onChange({ props: { ...node.props, [field.key]: value } })
                            }
                          />
                        ) : field.type === 'select' ? (
                          <select
                            value={String(node.props?.[field.key] ?? field.defaultValue ?? '')}
                            onChange={(event) =>
                              onChange({
                                props: { ...node.props, [field.key]: event.target.value },
                              })
                            }
                          >
                            {(field.options ?? []).map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        ) : field.type === 'textarea' ? (
                          <textarea
                            value={String(node.props?.[field.key] ?? '')}
                            onChange={(event) =>
                              onChange({
                                props: { ...node.props, [field.key]: event.target.value },
                              })
                            }
                          />
                        ) : field.type === 'number' ? (
                          <span className="inspector-number-row">
                            <input
                              type="range"
                              aria-label={field.label + ' slider'}
                              min={field.min ?? 0}
                              max={field.max ?? Math.max(100, Number(node.props?.[field.key] ?? 0))}
                              value={Number(node.props?.[field.key] ?? 0)}
                              onChange={(event) =>
                                onChange({
                                  props: { ...node.props, [field.key]: Number(event.target.value) },
                                })
                              }
                            />
                            <input
                              type="number"
                              aria-label={field.label}
                              min={field.min}
                              max={field.max}
                              value={String(node.props?.[field.key] ?? '')}
                              onChange={(event) =>
                                onChange({
                                  props: { ...node.props, [field.key]: Number(event.target.value) },
                                })
                              }
                            />
                          </span>
                        ) : (
                          <input
                            type="text"
                            value={String(node.props?.[field.key] ?? '')}
                            onChange={(event) =>
                              onChange({
                                props: {
                                  ...node.props,
                                  [field.key]: event.target.value,
                                },
                              })
                            }
                          />
                        )}
                      </FieldLabel>
                      {field.bindable && (
                        <select
                          aria-label={`Bind ${field.label}`}
                          value={node.bindings?.[field.key] ?? ''}
                          onChange={(event) =>
                            onChange({
                              bindings: { ...node.bindings, [field.key]: event.target.value },
                            })
                          }
                        >
                          <option value="">Static value</option>
                          {bindingFields.filter(field => categoriesEnabled || field.path !== 'categories').map((field) => (
                            <option key={field.path} value={field.path}>
                              {field.label}
                            </option>
                          ))}
                          {publicDocumentFields.filter(key => categoriesEnabled || key !== 'categories').map((key) => (
                            <option key={key} value={key}>
                              Document {key}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )
                })}
          </details>
        )}
      {node.kind === 'postListing' && tab === 'layout' && (
        <SaveReusableView node={node} onChange={onChange} disabled={disabled} />
      )}
      {node.kind === 'form' && showFields && (
        <>
          {renderDocumentPicker?.(
            'forms',
            'Published Form',
            String(node.props?.formID ?? ''),
            (value) =>
              onChange({
                props: { ...node.props, formID: value.split(',').filter(Boolean).pop() || '' },
              }),
          )}
          <p>
            Fields, validation, notifications, and internal styling are managed in{' '}
            <a
              href={
                node.props?.formID
                  ? `/admin/collections/forms/${encodeURIComponent(String(node.props.formID))}`
                  : '/admin/collections/forms'
              }
              target="_blank"
              rel="noreferrer"
            >
              Forms
            </a>
            . Publishing changes there updates every placement.
          </p>
        </>
      )}
      {isViewPlacement(node.kind) && showFields && (
        <ViewPlacementSetup
          key={node.id}
          node={node}
          onChange={onChange}
          renderPicker={renderDocumentPicker}
        />
      )}
      {isViewPlacement(node.kind) &&
        showFields &&
        renderDocumentPicker?.(
          'saved-views',
          'Saved View',
          String(node.props?.viewID ?? ''),
          (value) =>
            onChange({
              props: { ...node.props, viewID: value.split(',').filter(Boolean).pop() || '' },
            }),
        )}
      {isViewPlacement(node.kind) && (
        <p>
          Query and internal styling are managed in{' '}
          <a
            href={`/admin/collections/saved-views/${encodeURIComponent(String(node.props?.viewID || ''))}`}
            target="_blank"
            rel="noreferrer"
          >
            Saved Views
          </a>
          .
        </p>
      )}
      {Object.entries(sections[tab]).map(([label, keys]) => {
        const capability =
          label === 'Typography'
            ? 'typography'
            : label === 'Background'
              ? 'background'
              : label === 'Borders and shadows'
                ? 'border'
                : label === 'Image'
                  ? 'image'
                  : tab === 'advanced'
                    ? 'advanced'
                    : 'layout'
        if (definition && !definition.controls.includes(capability)) return null
        if (label === 'Image' && node.kind !== 'image') return null
        if (label === 'Background' && target === 'block') return null
        if (label === 'Arrangement' && !definition?.container) return null
        return (
          <details key={label} open={label === 'Size and spacing' || label === 'Typography'}>
            <summary>{label}</summary>
            {label === 'Image' && (
              <FocalPoint
                url={
                  node.media && typeof node.media === 'object' && 'url' in node.media
                    ? String(node.media.url)
                    : undefined
                }
                value={inherited.objectPosition ?? '50% 50%'}
                update={(v) => update('objectPosition', v)}
              />
            )}
            {keys
              .filter(
                (key) =>
                  !isViewPlacement(node.kind) ||
                  ['width', 'minWidth', 'maxWidth', 'padding', 'margin'].includes(key),
              )
              .map((key) => (
                <VisualStyleControl
                  key={`${node.id}-${key}`}
                  name={key}
                  values={values}
                  inheritedValues={inherited}
                  responsive={state === 'normal'}
                  state={state}
                  setState={target === 'block' ? setState : undefined}
                  updateMany={(patch) => {
                    const next = { ...values }
                    for (const [k, v] of Object.entries(patch)) {
                      if (v && !validStyleValue(k, v)) return
                      if (v) next[k] = v
                      else delete next[k]
                    }
                    if (state === 'normal') writeStyles({ ...authoredStyles, [viewport]: next })
                    else updatePresentation({ [state]: next })
                  }}
                  value={values[key] ?? ''}
                  inherited={inherited[key]}
                  update={(value) => update(key, value)}
                />
              ))}
          </details>
        )
      })}
      {tab === 'style' && target === 'block' && !isViewPlacement(node.kind) && (
        <BackgroundControls
          key={node.id + viewport}
          background={presentation.background}
          device={viewport}
          change={(background) => updatePresentation({ background })}
          renderMedia={renderBackgroundMedia}
          color={inherited.backgroundColor ?? ''}
          gradient={inherited.backgroundImage ?? ''}
          styleChange={(key, value) => {
            if (value && !validStyleValue(key, value)) {
              setError('Invalid background value.')
              return
            }
            const next = { ...node.styles?.[viewport] }
            if (value) next[key] = value
            else delete next[key]
            onChange({ styles: { ...node.styles, [viewport]: next } })
          }}
          reset={() => {
            const next = { ...node.styles?.[viewport] }
            delete next.backgroundColor
            delete next.backgroundImage
            onChange({
              styles: { ...node.styles, [viewport]: next },
              presentation: {
                ...presentation,
                background:
                  viewport === 'desktop'
                    ? { responsive: presentation.background?.responsive }
                    : {
                        ...presentation.background,
                        responsive: {
                          ...presentation.background?.responsive,
                          [viewport]: undefined,
                        },
                      },
              },
            })
          }}
        />
      )}
      {tab === 'style' && target === 'block' && definition?.container && (
        <details>
          <summary>Top and bottom separators</summary>
          {(['top', 'bottom'] as const).map((side) => {
            const settings = presentation.separators?.[side]
            const change = (patch: Partial<NonNullable<typeof settings>>) =>
              updatePresentation({
                separators: {
                  ...presentation.separators,
                  [side]: { shape: 'wave', ...settings, ...patch },
                },
              })
            return (
              <fieldset key={side}>
                <legend>{title(side)}</legend>
                <label>
                  Shape
                  <select
                    value={settings?.shape ?? ''}
                    onChange={(event) =>
                      event.target.value
                        ? change({ shape: event.target.value })
                        : updatePresentation({
                            separators: { ...presentation.separators, [side]: undefined },
                          })
                    }
                  >
                    <option value="">None</option>
                    {Object.keys(separatorPaths).map((shape) => (
                      <option key={shape}>{shape}</option>
                    ))}
                  </select>
                </label>
                {settings && (
                  <>
                    <PaintControl
                      label={`${title(side)} separator color`}
                      value={settings.color ?? ''}
                      update={(color) => change({ color })}
                    />
                    {(['height', 'width', 'layers'] as const).map((key) => (
                      <label key={key}>
                        {title(key)}
                        <input
                          type="number"
                          min={1}
                          max={key === 'layers' ? 3 : 1000}
                          value={
                            settings[key] ?? (key === 'layers' ? 1 : key === 'width' ? 100 : 48)
                          }
                          onChange={(event) => change({ [key]: Number(event.target.value) })}
                        />
                      </label>
                    ))}
                    <label>
                      <input
                        type="checkbox"
                        checked={!!settings.flip}
                        onChange={(event) => change({ flip: event.target.checked })}
                      />
                      Flip
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!settings.shadow}
                        onChange={(event) => change({ shadow: event.target.checked })}
                      />
                      Shadow
                    </label>
                  </>
                )}
              </fieldset>
            )
          })}
        </details>
      )}
      {tab === 'style' && (node.kind === 'image' || target === 'media') && (
        <details open>
          <summary>Image treatments</summary>
          {(['zoom', 'brightness', 'contrast', 'saturation', 'grayscale', 'blur'] as const).map(
            (key) => (
              <label key={key}>
                {title(key)}
                <input
                  type="range"
                  min={0}
                  max={key === 'blur' ? 40 : key === 'grayscale' ? 1 : 5}
                  step={0.05}
                  value={presentation.media?.[key] ?? (['grayscale', 'blur'].includes(key) ? 0 : 1)}
                  onChange={(event) =>
                    updatePresentation({
                      media: { ...presentation.media, [key]: Number(event.target.value) },
                    })
                  }
                />
                <input
                  aria-label={`${title(key)} value`}
                  type="number"
                  min={0}
                  max={key === 'blur' ? 40 : key === 'grayscale' ? 1 : 5}
                  step={0.05}
                  value={presentation.media?.[key] ?? (['grayscale', 'blur'].includes(key) ? 0 : 1)}
                  onChange={(event) =>
                    updatePresentation({
                      media: { ...presentation.media, [key]: Number(event.target.value) },
                    })
                  }
                />
              </label>
            ),
          )}
          <label>
            Image shape
            <select
              value={presentation.media?.shape ?? 'none'}
              onChange={(event) =>
                updatePresentation({
                  media: { ...presentation.media, shape: event.target.value as 'none' },
                })
              }
            >
              {['none', 'circle', 'ellipse', 'rounded', 'blob', 'diagonal'].map((shape) => (
                <option key={shape}>{shape}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => updatePresentation({ media: undefined })}>
            Reset image treatments
          </button>
        </details>
      )}
      {tab === 'advanced' && !isViewPlacement(node.kind) && (
        <>
          <details>
            <summary>General</summary>
            <label>
              HTML anchor
              <input
                value={node.anchor ?? ''}
                onChange={(event) => onChange({ anchor: event.target.value })}
              />
            </label>
            <label>
              HTML tag
              <select
                value={presentation.tag ?? 'div'}
                onChange={(event) =>
                  updatePresentation({ tag: event.target.value as BlockPresentation['tag'] })
                }
              >
                {['div', 'section', 'article', 'aside', 'figure'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              CSS classes
              <input
                value={presentation.className ?? ''}
                onChange={(event) => updatePresentation({ className: event.target.value })}
              />
            </label>
          </details>
          <details>
            <summary>Link</summary>
            {['url', 'title', 'rel'].map((key) => (
              <label key={key}>
                {title(key)}
                <CommittedText
                  key={`${node.id}-${key}`}
                  value={String(presentation.link?.[key as 'url'] ?? '')}
                  onCommit={(value) =>
                    updatePresentation({ link: { ...presentation.link, [key]: value } })
                  }
                />
              </label>
            ))}
            {(['newTab', 'lightbox'] as const).map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={!!presentation.link?.[key]}
                  onChange={(event) =>
                    updatePresentation({
                      link: { ...presentation.link, [key]: event.target.checked },
                    })
                  }
                />
                {title(key)}
              </label>
            ))}
          </details>
          <details>
            <summary>Responsive visibility</summary>
            {(['desktop', 'tablet', 'mobile'] as const).map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={!!presentation.hidden?.[key]}
                  onChange={(event) =>
                    updatePresentation({
                      hidden: { ...presentation.hidden, [key]: event.target.checked },
                    })
                  }
                />
                Hide on {key}
              </label>
            ))}
          </details>
          <details>
            <summary>Custom attributes</summary>
            <label>
              Attributes (one name=value per line)
              <textarea
                key={`${node.id}-attributes`}
                defaultValue={Object.entries(presentation.attributes ?? {})
                  .map(([key, value]) => `${key}=${value}`)
                  .join('\n')}
                onBlur={(event) =>
                  updatePresentation({
                    attributes: Object.fromEntries(
                      event.target.value
                        .split('\n')
                        .filter(Boolean)
                        .map((line) => {
                          const at = line.indexOf('=')
                          return [line.slice(0, at).trim(), line.slice(at + 1)]
                        }),
                    ),
                  })
                }
              />
            </label>
          </details>
          <details>
            <summary>Custom CSS</summary>
            <p>
              Use declarations or &amp;-scoped rules. Example: &amp;:hover &#123; opacity: 0.8;
              &#125;
            </p>
            <CommittedText
              key={`${node.id}-css`}
              multiline
              label="Custom CSS"
              value={presentation.css ?? ''}
              onCommit={(value) => updatePresentation({ css: value })}
            />
          </details>
          <details>
            <summary>Motion effects</summary>
            <label>
              Trigger
              <select
                value={presentation.motion?.trigger ?? ''}
                onChange={(event) =>
                  updatePresentation({
                    motion: event.target.value
                      ? {
                          ...presentation.motion,
                          trigger: event.target.value as 'entrance' | 'scroll',
                        }
                      : undefined,
                  })
                }
              >
                <option value="">None</option>
                <option value="entrance">Entrance</option>
                <option value="scroll">Scroll</option>
              </select>
            </label>
            {presentation.motion && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void import('../blocks/Motion').then((module) =>
                      module.previewBlockMotion(node.id, presentation.motion!),
                    )
                  }}
                >
                  Preview motion
                </button>
                {['x', 'y', 'scale', 'rotate', 'skew', 'opacity', 'blur', 'duration', 'delay'].map(
                  (key) => (
                    <label key={key}>
                      {title(key)}
                      <input
                        type="number"
                        step="0.1"
                        value={presentation.motion?.[key as 'x'] ?? ''}
                        onChange={(event) =>
                          updatePresentation({
                            motion: { ...presentation.motion!, [key]: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                  ),
                )}
                <label>
                  Easing
                  <select
                    value={presentation.motion.easing ?? 'ease-out'}
                    onChange={(event) =>
                      updatePresentation({
                        motion: { ...presentation.motion!, easing: event.target.value as 'ease' },
                      })
                    }
                  >
                    {['ease', 'linear', 'ease-in', 'ease-out'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </details>
          <details>
            <summary>Conditional display</summary>
            <label>
              Match
              <select
                value={condition.match}
                onChange={(event) =>
                  updatePresentation({
                    condition: { ...condition, match: event.target.value as 'all' | 'any' },
                  })
                }
              >
                <option value="all">All conditions</option>
                <option value="any">Any condition</option>
              </select>
            </label>
            {condition.rules.map((rule, index) => (
              <div key={index}>
                <select
                  aria-label="Condition field"
                  value={rule.field}
                  onChange={(event) => changeRule(index, { field: event.target.value })}
                >
                  {publicDocumentFields.filter(key => categoriesEnabled || key !== 'categories').map((key) => (
                    <option key={key}>{key}</option>
                  ))}
                </select>
                <select
                  aria-label="Condition operator"
                  value={rule.operator}
                  onChange={(event) =>
                    changeRule(index, { operator: event.target.value as Rule['operator'] })
                  }
                >
                  {['equals', 'notEquals', 'empty', 'notEmpty', 'contains'].map((key) => (
                    <option key={key}>{key}</option>
                  ))}
                </select>
                <input
                  aria-label="Condition value"
                  value={rule.value ?? ''}
                  onChange={(event) => changeRule(index, { value: event.target.value })}
                />
                <button
                  type="button"
                  onClick={() =>
                    updatePresentation({
                      condition: {
                        ...condition,
                        rules: condition.rules.filter((_, i) => i !== index),
                      },
                    })
                  }
                >
                  Remove condition
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                updatePresentation({
                  condition: {
                    ...condition,
                    rules: [...condition.rules, { field: 'title', operator: 'notEmpty' }],
                  },
                })
              }
            >
              Add condition
            </button>
            {(['start', 'end'] as const).map((key) => (
              <label key={key}>
                {title(key)} (ISO date with timezone)
                <input
                  key={`${node.id}-${key}`}
                  defaultValue={condition[key] ?? ''}
                  placeholder="2026-12-01T00:00:00Z"
                  onBlur={(event) =>
                    updatePresentation({
                      condition: { ...condition, [key]: event.target.value || undefined },
                    })
                  }
                />
              </label>
            ))}
          </details>
        </>
      )}
      {definition?.inspector?.[tab]?.(node, onChange)}
    </fieldset>
  )
}

function CommittedText({
  value,
  onCommit,
  multiline,
  label,
}: {
  value: string
  onCommit: (value: string) => void
  multiline?: boolean
  label?: string
}) {
  const [draft, setDraft] = useState(value)
  const [previous, setPrevious] = useState(value)
  if (previous !== value) {
    setPrevious(value)
    setDraft(value)
  }
  return multiline ? (
    <textarea
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
    />
  ) : (
    <input
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
    />
  )
}
