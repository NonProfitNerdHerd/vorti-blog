'use client'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { getBlockDefinition } from '../blocks/registry'
import { blockIcons } from '../blocks/CatalogRenderer'
import {
  publicDocumentFields,
  validatePresentation,
  type BlockPresentation,
  type Rule,
} from '../blocks/presentation'
import { styleOptions } from '../blocks/style-schema'
import { resolveStyle, validStyleValue, type ContentNode, type Viewport } from '../content/model'
import './block-inspector.css'

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
  bindingFields = [],
  showFields = true,
}: {
  node: ContentNode
  showFields?: boolean
  bindingFields?: Array<{ path: string; label: string }>
  onChange: (patch: Partial<ContentNode>) => void
  viewport?: Viewport
  disabled?: boolean
  children?: ReactNode
}) {
  const [ownTab, setOwnTab] = useState<InspectorTab>('style')
  const sharedTab = useContext(InspectorTabContext)
  const tab = sharedTab?.tab ?? ownTab,
    setTab = sharedTab?.setTab ?? setOwnTab
  const [device, setDevice] = useState<Viewport>('desktop')
  const [state, setState] = useState<'normal' | 'hover' | 'focus'>('normal')
  const [error, setError] = useState('')
  const viewport = suppliedViewport ?? device
  const definition = getBlockDefinition(node.kind)
  const presentation = node.presentation ?? {}
  const values = state === 'normal' ? (node.styles?.[viewport] ?? {}) : (presentation[state] ?? {})
  const inherited = resolveStyle(node.styles, viewport)
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
    if (state === 'normal') onChange({ styles: { ...node.styles, [viewport]: next } })
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
    <fieldset disabled={disabled} className="unified-block-inspector">
      <header>
        <strong>
          {definition?.icon} {definition?.label ?? node.label ?? node.kind}
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
            {title(name)}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="block-inspector-device">
        <label>
          Device
          <select
            value={viewport}
            onChange={(event) => setDevice(event.target.value as Viewport)}
            disabled={!!suppliedViewport}
          >
            {['desktop', 'tablet', 'mobile'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          State
          <select value={state} onChange={(event) => setState(event.target.value as typeof state)}>
            {['normal', 'hover', 'focus'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      {tab === 'style' && (
        <details open>
          <summary>Content</summary>
          {children}
          {showFields &&
            definition?.fields.map((field) => (
              <div key={field.key}>
                <label>
                  {field.label}
                  {field.type === 'toggle' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(node.props?.[field.key])}
                      onChange={(event) =>
                        onChange({ props: { ...node.props, [field.key]: event.target.checked } })
                      }
                    />
                  ) : field.type === 'select' || field.type === 'icon' ? (
                    <select
                      value={String(node.props?.[field.key] ?? field.defaultValue ?? '')}
                      onChange={(event) =>
                        onChange({ props: { ...node.props, [field.key]: event.target.value } })
                      }
                    >
                      {(field.type === 'icon'
                        ? Object.keys(blockIcons)
                        : (field.options ?? [])
                      ).map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      value={String(node.props?.[field.key] ?? '')}
                      onChange={(event) =>
                        onChange({ props: { ...node.props, [field.key]: event.target.value } })
                      }
                    />
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={String(node.props?.[field.key] ?? '')}
                      onChange={(event) =>
                        onChange({
                          props: {
                            ...node.props,
                            [field.key]:
                              field.type === 'number'
                                ? Number(event.target.value)
                                : event.target.value,
                          },
                        })
                      }
                    />
                  )}
                </label>
                {field.bindable && (
                  <select
                    aria-label={`Bind ${field.label}`}
                    value={node.bindings?.[field.key] ?? ''}
                    onChange={(event) =>
                      onChange({ bindings: { ...node.bindings, [field.key]: event.target.value } })
                    }
                  >
                    <option value="">Static value</option>
                    {bindingFields.map((field) => (
                      <option key={field.path} value={field.path}>
                        {field.label}
                      </option>
                    ))}
                    {publicDocumentFields.map((key) => (
                      <option key={key} value={key}>
                        Document {key}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
        </details>
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
        if (label === 'Arrangement' && !definition?.container) return null
        return (
          <details key={label} open={label === 'Size and spacing' || label === 'Typography'}>
            <summary>{label}</summary>
            {keys.map((key) => (
              <StyleInput
                key={`${node.id}-${viewport}-${state}-${key}`}
                name={key}
                value={values[key] ?? ''}
                inherited={inherited[key]}
                update={(value) => update(key, value)}
              />
            ))}
          </details>
        )
      })}
      {tab === 'style' && (
        <details>
          <summary>Background image and overlay</summary>
          <label>
            Background image URL
            <CommittedText
              key={`${node.id}-background`}
              value={presentation.background?.imageURL ?? ''}
              onCommit={(value) =>
                updatePresentation({ background: { ...presentation.background, imageURL: value } })
              }
            />
          </label>
          <label>
            Overlay color
            <input
              type="color"
              value={presentation.background?.overlay ?? '#000000'}
              onChange={(event) =>
                updatePresentation({
                  background: { ...presentation.background, overlay: event.target.value },
                })
              }
            />
          </label>
          <label>
            Overlay opacity
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={presentation.background?.opacity ?? 0}
              onChange={(event) =>
                updatePresentation({
                  background: { ...presentation.background, opacity: Number(event.target.value) },
                })
              }
            />
          </label>
          <button type="button" onClick={() => updatePresentation({ background: undefined })}>
            Reset background image
          </button>
        </details>
      )}
      {tab === 'advanced' && (
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
                  {publicDocumentFields.map((key) => (
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

function StyleInput({
  name,
  value,
  inherited,
  update,
}: {
  name: string
  value: string
  inherited?: string
  update: (value: string) => void
}) {
  const [separate, setSeparate] = useState(value.trim().split(/\s+/).length > 1)
  const [draft, setDraft] = useState(value)
  const [previous, setPrevious] = useState(value)
  if (previous !== value) {
    setPrevious(value)
    setDraft(value)
  }
  const change = (next: string) => {
    setDraft(next)
    update(next)
  }
  if (name === 'backgroundImage') {
    const match = /^linear-gradient\((\d+)deg, (#[a-fA-F0-9]{6}), (#[a-fA-F0-9]{6})\)$/.exec(value)
    const angle = match?.[1] ?? '90',
      first = match?.[2] ?? '#ffffff',
      second = match?.[3] ?? '#333333'
    const gradient = (direction: string, start: string, end: string) =>
      update(`linear-gradient(${direction}deg, ${start}, ${end})`)
    return (
      <fieldset>
        <legend>Gradient</legend>
        <label>
          Start color
          <input
            type="color"
            value={first}
            onChange={(event) => gradient(angle, event.target.value, second)}
          />
        </label>
        <label>
          End color
          <input
            type="color"
            value={second}
            onChange={(event) => gradient(angle, first, event.target.value)}
          />
        </label>
        <label>
          Angle
          <input
            type="range"
            min="0"
            max="360"
            value={angle}
            onChange={(event) => gradient(event.target.value, first, second)}
          />
        </label>
        <button type="button" onClick={() => gradient(angle, first, second)}>
          Apply gradient
        </button>
        <button type="button" onClick={() => update('')}>
          Reset gradient
        </button>
      </fieldset>
    )
  }
  if (name === 'padding' || name === 'margin') {
    const parts = value.split(/\s+/),
      sides = [
        parts[0],
        parts[1] ?? parts[0],
        parts[2] ?? parts[0],
        parts[3] ?? parts[1] ?? parts[0],
      ]
    return (
      <fieldset>
        <legend>{title(name)}</legend>
        <label>
          <input
            type="checkbox"
            checked={!separate}
            onChange={(event) => setSeparate(!event.target.checked)}
          />
          Linked sides
        </label>
        {separate ? (
          ['Top', 'Right', 'Bottom', 'Left'].map((side, index) => (
            <label key={side}>
              {side}
              <input
                value={sides[index] ?? ''}
                onChange={(event) => {
                  const next = sides.map((value) => value || '0')
                  next[index] = event.target.value || '0'
                  change(next.join(' '))
                }}
              />
            </label>
          ))
        ) : (
          <input
            aria-label={title(name)}
            value={draft}
            placeholder={inherited ?? 'Inherit'}
            onChange={(event) => change(event.target.value)}
          />
        )}
        <button type="button" onClick={() => change('')}>
          Reset {title(name)}
        </button>
      </fieldset>
    )
  }
  const unit = /^(-?[\d.]+)(px|rem|em|%|vh|vw)$/.exec(value)
  const dimension =
    /^(width|height|minWidth|maxWidth|minHeight|maxHeight|fontSize|letterSpacing|gap|borderWidth|borderRadius|top|right|bottom|left)$/.test(
      name,
    )
  return (
    <label>
      {title(name)}
      <div className="block-inspector-control">
        {styleOptions[name] ? (
          <select value={value} onChange={(event) => change(event.target.value)}>
            <option value="">Inherit</option>
            {styleOptions[name].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              aria-label={title(name)}
              value={draft}
              placeholder={inherited ?? 'Inherit'}
              onChange={(event) => change(event.target.value)}
            />
            {dimension && (
              <>
                <input
                  aria-label={`${title(name)} slider`}
                  type="range"
                  min="0"
                  max={name === 'fontSize' ? 200 : 1000}
                  value={Number(unit?.[1]) || 0}
                  onChange={(event) => change(`${event.target.value}${unit?.[2] ?? 'px'}`)}
                />
                <select
                  aria-label={`${title(name)} unit`}
                  value={unit?.[2] ?? 'px'}
                  onChange={(event) => change(`${unit?.[1] ?? 0}${event.target.value}`)}
                >
                  {['px', 'rem', 'em', '%', 'vh', 'vw'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </>
            )}
            {/Color$|^color$/.test(name) && (
              <input
                aria-label={`${title(name)} picker`}
                type="color"
                value={/^#[\da-f]{6}$/i.test(value) ? value : '#000000'}
                onChange={(event) => change(event.target.value)}
              />
            )}
          </>
        )}
        <button type="button" aria-label={`Reset ${title(name)}`} onClick={() => change('')}>
          ↺
        </button>
      </div>
    </label>
  )
}
