'use client'
import { useState } from 'react'
import {
  resolveStyle,
  validStyleValue,
  type BlockStyle,
  type ResponsiveBlockStyle,
  type Viewport,
} from '../content/model'

export function BlockStyleControls({
  value,
  onChange,
  viewport: suppliedViewport,
}: {
  value?: ResponsiveBlockStyle
  onChange: (value: ResponsiveBlockStyle) => void
  viewport?: Viewport
}) {
  const [device, setDevice] = useState<Viewport>('desktop')
  const viewport = suppliedViewport ?? device
  const current = resolveStyle(value, viewport)
  const [error, setError] = useState('')
  const update = (key: keyof BlockStyle, next: string) => {
    if (next && !validStyleValue(key, next)) {
      setError(`Invalid ${key}. Use a color or a size such as 16px, 1rem, or 100%.`)
      return
    }
    setError('')
    const styles = { ...value?.[viewport] }
    if (next) styles[key] = next as never
    else delete styles[key]
    onChange({ ...value, [viewport]: styles })
  }
  return (
    <div className="block-style-controls">
      {!suppliedViewport && (
        <label>
          Style viewport
          <select value={device} onChange={(event) => setDevice(event.target.value as Viewport)}>
            {['desktop', 'tablet', 'mobile'].map((device) => (
              <option key={device}>{device}</option>
            ))}
          </select>
        </label>
      )}
      <p>Editing {viewport}. Empty values inherit from the larger viewport.</p>
      {error && <p role="alert">{error}</p>}
      {(
        [
          'backgroundColor',
          'color',
          'width',
          'maxWidth',
          'fontSize',
          'lineHeight',
          'borderWidth',
          'borderColor',
          'borderRadius',
          'gap',
          'minHeight',
        ] as const
      ).map((key) => (
        <label key={key}>
          {key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}
          <input
            key={`${viewport}-${key}-${value?.[viewport]?.[key] ?? ''}`}
            aria-label={key}
            defaultValue={value?.[viewport]?.[key] ?? ''}
            placeholder={current[key] ?? 'Inherit'}
            onBlur={(event) => update(key, event.target.value.trim())}
          />
        </label>
      ))}
      <label>
        Text alignment
        <select
          value={value?.[viewport]?.textAlign ?? ''}
          onChange={(event) => update('textAlign', event.target.value)}
        >
          <option value="">Inherit</option>
          {['left', 'center', 'right'].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
      {(['padding', 'margin'] as const).map((key) => (
        <Spacing
          key={`${key}-${viewport}`}
          label={key}
          value={value?.[viewport]?.[key] ?? ''}
          update={(value) => update(key, value)}
        />
      ))}
    </div>
  )
}
function Spacing({
  label,
  value,
  update,
}: {
  label: string
  value: string
  update: (value: string) => void
}) {
  const [individual, setIndividual] = useState(value.split(' ').length > 1)
  const parts = value.trim().split(/\s+/)
  const sides = [
    parts[0],
    parts[1] ?? parts[0],
    parts[2] ?? parts[0],
    parts[3] ?? parts[1] ?? parts[0],
  ]
  return (
    <fieldset>
      <legend>{label}</legend>
      <label>
        <input
          type="checkbox"
          checked={!individual}
          onChange={(event) => setIndividual(!event.target.checked)}
        />
        Linked sides
      </label>
      {individual ? (
        ['Top', 'Right', 'Bottom', 'Left'].map((side, index) => (
          <label key={side}>
            {side}
            <input
              aria-label={`${label} ${side}`}
              key={`${index}-${value}`}
              defaultValue={sides[index]}
              onBlur={(event) => {
                const next = sides.map((part) => part || '0')
                next[index] = event.target.value || '0'
                update(next.join(' '))
              }}
            />
          </label>
        ))
      ) : (
        <input
          aria-label={label}
          key={value}
          defaultValue={value}
          placeholder="16px"
          onBlur={(event) => update(event.target.value)}
        />
      )}
    </fieldset>
  )
}
