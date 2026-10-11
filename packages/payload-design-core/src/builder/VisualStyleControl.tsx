'use client'
import { useState } from 'react'
import {
  DeviceControl,
  DimensionControl,
  IconButton,
  InspectorIcon,
  Popover,
} from './InspectorControls'
import { styleOptions } from '../blocks/style-schema'

export function PaintControl({
  label,
  value,
  update,
  gradient = false,
}: {
  label: string
  value: string
  update: (v: string) => void
  gradient?: boolean
}) {
  const [draft, setDraft] = useState(value),
    [previous, setPrevious] = useState(value)
  if (previous !== value) {
    setPrevious(value)
    setDraft(value)
  }
  const colors = value.match(/#[\da-f]{6,8}/gi) ?? ['#ffffff', '#333333']
  const angle = /^linear-gradient\((\d+)deg/.exec(value)?.[1] ?? '90'
  const changeStop = (index: number, color: string) => {
    const next = [...colors]
    next[index] = color
    update(`linear-gradient(${angle}deg, ${next.join(', ')})`)
  }
  return (
    <Popover
      label={label}
      trigger={
        <span className="inspector-swatch">
          <span style={{ background: value || 'transparent' }} />
          {value ? label : `${label}: none`}
        </span>
      }
    >
      {gradient ? (
        <>
          {colors.map((color, i) => (
            <label key={i}>
              Stop {i + 1}
              <input
                type="color"
                aria-label={`${label} stop ${i + 1}`}
                value={color.slice(0, 7)}
                onChange={(e) => changeStop(i, e.target.value)}
              />
              <button
                type="button"
                disabled={colors.length <= 2}
                onClick={() =>
                  update(
                    `linear-gradient(${angle}deg, ${colors.filter((_, j) => j !== i).join(', ')})`,
                  )
                }
              >
                Remove stop
              </button>
            </label>
          ))}
          <button
            type="button"
            disabled={colors.length >= 8}
            onClick={() =>
              update(`linear-gradient(${angle}deg, ${[...colors, '#ffffff'].join(', ')})`)
            }
          >
            Add stop
          </button>
          <label>
            Angle
            <input
              type="range"
              min="0"
              max="360"
              aria-label={`${label} angle`}
              value={angle}
              onChange={(e) =>
                update(`linear-gradient(${e.target.value}deg, ${colors.join(', ')})`)
              }
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Color
            <input
              type="color"
              aria-label={`${label} picker`}
              value={/^#[\da-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000'}
              onChange={(e) => update(e.target.value + (value.length === 9 ? value.slice(7) : ''))}
            />
          </label>
          <label>
            Opacity
            <input
              type="range"
              min="0"
              max="100"
              aria-label={`${label} opacity`}
              value={
                value.length === 9 ? Math.round((parseInt(value.slice(7), 16) / 255) * 100) : 100
              }
              onChange={(e) =>
                update(
                  (/^#[\da-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000') +
                    Math.round(Number(e.target.value) * 2.55)
                      .toString(16)
                      .padStart(2, '0'),
                )
              }
            />
          </label>
        </>
      )}
      <label>
        Value
        <input
          aria-label={`${label} value`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            update(e.target.value)
          }}
          onBlur={() => setDraft(value)}
        />
      </label>
      <button type="button" onClick={() => update('')}>
        Reset {label}
      </button>
    </Popover>
  )
}
export const expandSides = (value: string) => {
  const p = value.trim().split(/\s+/)
  return [p[0] || '', p[1] ?? p[0] ?? '', p[2] ?? p[0] ?? '', p[3] ?? p[1] ?? p[0] ?? '']
}
function ShadowControl({ value, update }: { value: string; update: (value: string) => void }) {
  const match = /^(-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px(?: ([\d.]+)px)? (#[\da-f]{3,8})$/i.exec(
    value,
  )
  const parts = [match?.[1] ?? '0', match?.[2] ?? '4', match?.[3] ?? '12', match?.[4] ?? '0']
  const color = match?.[5] ?? '#00000033'
  const change = (index: number, next: string) => {
    const result = [...parts]
    result[index] = next.replace(/px$/, '') || '0'
    update(`${result.map((v) => v + 'px').join(' ')} ${color}`)
  }
  return (
    <Popover label="Shadow" trigger={value || 'Add shadow'}>
      {['Horizontal offset', 'Vertical offset', 'Blur', 'Spread'].map((label, i) => (
        <div key={label}>
          <span>{label}</span>
          <DimensionControl
            label={`Shadow ${label.toLowerCase()}`}
            value={parts[i] + 'px'}
            units={['px']}
            negative={i < 2}
            update={(v) => change(i, v)}
          />
        </div>
      ))}
      <PaintControl
        label="Shadow color"
        value={color}
        update={(v) => update(`${parts.map((p) => p + 'px').join(' ')} ${v || '#00000000'}`)}
      />
      <button type="button" onClick={() => update('')}>
        Reset shadow
      </button>
    </Popover>
  )
}
export function FocalPoint({
  url,
  value,
  update,
}: {
  url?: string
  value: string
  update: (value: string) => void
}) {
  const [x, y] = value.split(/\s+/).map((v) => parseFloat(v))
  const horizontal = Number.isFinite(x) ? x : 50,
    vertical = Number.isFinite(y) ? y : 50
  return (
    <div>
      <button
        type="button"
        className="inspector-focal"
        aria-label="Image focal point"
        style={{ backgroundImage: url ? `url("${url}")` : undefined }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          update(
            `${Math.round(((e.clientX - r.left) / r.width) * 100)}% ${Math.round(((e.clientY - r.top) / r.height) * 100)}%`,
          )
        }}
      >
        <span style={{ left: `${horizontal}%`, top: `${vertical}%` }}>+</span>
      </button>
      <label>
        Horizontal focal point
        <input
          type="range"
          min="0"
          max="100"
          value={horizontal}
          onChange={(e) => update(`${e.target.value}% ${vertical}%`)}
        />
      </label>
      <label>
        Vertical focal point
        <input
          type="range"
          min="0"
          max="100"
          value={vertical}
          onChange={(e) => update(`${horizontal}% ${e.target.value}%`)}
        />
      </label>
    </div>
  )
}
export function VisualStyleControl({
  name,
  value,
  inherited,
  update,
  values,
  updateMany,
  inheritedValues,
  responsive = true,
  state,
  setState,
}: {
  name: string
  value: string
  inherited?: string
  update: (v: string) => void
  values: Record<string, string | undefined>
  inheritedValues: Record<string, string | undefined>
  updateMany: (patch: Record<string, string>) => void
  responsive?: boolean
  state: string
  setState: (v: 'normal' | 'hover' | 'focus') => void
}) {
  const vertical =
    name === 'alignItems'
      ? !String(inheritedValues.flexDirection).startsWith('column')
      : name === 'justifyContent' && String(inheritedValues.flexDirection).startsWith('column')
  const label =
    name === 'alignItems' || name === 'justifyContent'
      ? `Content ${vertical ? 'vertical' : 'horizontal'} ${name === 'justifyContent' ? 'justification' : 'alignment'}`
      : name.replace(/[A-Z]/g, (c) => ' ' + c.toLowerCase()).replace(/^./, (c) => c.toUpperCase())
  const [individual, setIndividual] = useState(
    value.trim().split(/\s+/).length > 1 ||
      ['Top', 'Right', 'Bottom', 'Left'].some((side) => values[name + side] !== undefined),
  )
  const effective = value || inherited || ''
  const dimension =
    /^(width|height|minWidth|maxWidth|minHeight|maxHeight|fontSize|letterSpacing|gap|borderWidth|borderRadius|top|right|bottom|left)$/.test(
      name,
    )
  return (
    <div className="inspector-property" data-inherited={!value}>
      <div className="inspector-property-heading">
        <span>{label}</span>
        {responsive && <DeviceControl label={label} />}
        <Popover
          label={`${label} state`}
          trigger={state === 'normal' ? '○' : state === 'hover' ? '↗' : '◎'}
        >
          <div className="inspector-segments">
            {(['normal', 'hover', 'focus'] as const).map((v) => (
              <button type="button" key={v} aria-pressed={state === v} onClick={() => setState(v)}>
                {v}
              </button>
            ))}
          </div>
        </Popover>
        <IconButton
          label={`Reset ${label}`}
          icon="reset"
          onClick={() =>
            name === 'padding' || name === 'margin'
              ? updateMany(
                  Object.fromEntries(
                    [name, ...['Top', 'Right', 'Bottom', 'Left'].map((s) => name + s)].map((k) => [
                      k,
                      '',
                    ]),
                  ),
                )
              : update('')
          }
        />
      </div>
      {!value &&
        inherited &&
        !['Top', 'Right', 'Bottom', 'Left'].some((side) => values[name + side] !== undefined) && (
          <small className="inspector-inherited">Inherited: {inherited}</small>
        )}
      {name === 'padding' || name === 'margin' ? (
        <>
          <IconButton
            label={individual ? `Link ${label} sides` : `Unlink ${label} sides`}
            icon={individual ? 'unlinked' : 'linked'}
            pressed={!individual}
            onClick={() => {
              if (individual) {
                updateMany(
                  Object.fromEntries([
                    [
                      name,
                      values[name + 'Top'] ??
                        inheritedValues[name + 'Top'] ??
                        expandSides(effective)[0],
                    ],
                    ...['Top', 'Right', 'Bottom', 'Left'].map((side) => [name + side, '']),
                  ]),
                )
              }
              setIndividual(!individual)
            }}
          />
          {individual ? (
            ['Top', 'Right', 'Bottom', 'Left'].map((side, i) => (
              <div
                key={side}
                className="inspector-side"
                data-inherited={values[name + side] === undefined && !value}
                title={
                  values[name + side] === undefined && !value
                    ? `${side}: inherited`
                    : `${side}: override`
                }
              >
                <span title={side}>
                  <InspectorIcon name={side.toLowerCase()} />
                </span>
                <DimensionControl
                  label={`${label} ${side.toLowerCase()}`}
                  value={
                    values[name + side] ?? inheritedValues[name + side] ?? expandSides(effective)[i]
                  }
                  negative={name === 'margin'}
                  update={(v) => updateMany({ [name + side]: v })}
                />
                <IconButton
                  label={`Reset ${label} ${side.toLowerCase()}`}
                  icon="reset"
                  onClick={() => {
                    const patch: Record<string, string> = { [name + side]: '' }
                    if (values[name]) {
                      const sides = expandSides(values[name]!)
                      patch[name] = ''
                      ;['Top', 'Right', 'Bottom', 'Left'].forEach((s, j) => {
                        if (s !== side) patch[name + s] = values[name + s] ?? sides[j]
                      })
                    }
                    updateMany(patch)
                  }}
                />
              </div>
            ))
          ) : (
            <DimensionControl
              label={label}
              value={effective}
              negative={name === 'margin'}
              update={(v) =>
                updateMany(
                  Object.fromEntries([
                    [name, v],
                    ...['Top', 'Right', 'Bottom', 'Left'].map((s) => [name + s, '']),
                  ]),
                )
              }
            />
          )}
        </>
      ) : /Color$|^color$/.test(name) ? (
        <PaintControl label={label} value={effective} update={update} />
      ) : name === 'backgroundImage' ? (
        <PaintControl label="Gradient" value={effective} update={update} gradient />
      ) : name === 'boxShadow' ? (
        <ShadowControl value={effective} update={update} />
      ) : ['textAlign', 'alignItems', 'justifyContent'].includes(name) ? (
        <div className="inspector-segments">
          {styleOptions[name].map((v, i) => (
            <button
              type="button"
              title={`${label}: ${v}`}
              aria-label={`${label}: ${v}`}
              aria-pressed={effective === v}
              key={v}
              onClick={() => update(v)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ transform: vertical ? 'rotate(90deg)' : undefined }}
              >
                <path
                  d={
                    i === 0
                      ? 'M4 4v16M7 7h12M7 12h8M7 17h12'
                      : i === 1
                        ? 'M12 3v18M5 7h14M8 12h8M5 17h14'
                        : i === 2
                          ? 'M20 4v16M5 7h12M9 12h8M5 17h12'
                          : 'M4 4v16M20 4v16M7 7h10M7 12h10M7 17h10'
                  }
                />
              </svg>
            </button>
          ))}
        </div>
      ) : dimension ? (
        <DimensionControl
          label={label}
          value={effective}
          negative={['top', 'right', 'bottom', 'left', 'letterSpacing'].includes(name)}
          units={
            ['fontSize', 'letterSpacing', 'borderWidth', 'borderRadius', 'gap'].includes(name)
              ? ['px', 'rem', 'em']
              : undefined
          }
          update={update}
        />
      ) : styleOptions[name] ? (
        <select aria-label={label} value={value} onChange={(e) => update(e.target.value)}>
          <option value="">Inherit</option>
          {styleOptions[name].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      ) : (
        <input
          aria-label={label}
          value={value}
          placeholder={inherited || 'Inherit'}
          onChange={(e) => update(e.target.value)}
        />
      )}
    </div>
  )
}
