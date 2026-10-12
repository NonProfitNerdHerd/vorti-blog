'use client'
import type { ReactNode } from 'react'
import {
  type BlockPresentation,
  type BackgroundSettings,
  resolveBackground,
} from '../blocks/presentation'
import { PaintControl, FocalPoint } from './VisualStyleControl'
import { DeviceControl } from './InspectorControls'
export function BackgroundControls({
  background,
  device,
  change,
  renderMedia,
  color,
  gradient,
  styleChange,
  reset,
}: {
  background: BlockPresentation['background']
  device: 'desktop' | 'tablet' | 'mobile'
  change: (background: BlockPresentation['background']) => void
  renderMedia?: (
    value: BlockPresentation['background'],
    change: (value: BackgroundSettings) => void,
  ) => ReactNode
  color: string
  gradient: string
  styleChange: (key: string, value: string) => void
  reset: () => void
}) {
  const value = resolveBackground(background, device)
  const mode = value.mode ?? (value.imageURL ? 'image' : gradient ? 'gradient' : 'solid')
  const update = (patch: Partial<BackgroundSettings>) =>
    change(
      device === 'desktop'
        ? { ...background, ...patch }
        : {
            ...background,
            responsive: {
              ...background?.responsive,
              [device]: { ...background?.responsive?.[device], ...patch },
            },
          },
    )
  return (
    <details>
      <summary>Background</summary>
      <div className="inspector-property-heading">
        <span>Background type</span>
        <DeviceControl label="Background" />
      </div>
      <div className="inspector-segments">
        {(['solid', 'gradient', 'image'] as const).map((modeOption) => (
          <button
            type="button"
            key={modeOption}
            aria-pressed={mode === modeOption}
            onClick={() => update({ mode: modeOption })}
          >
            {modeOption}
          </button>
        ))}
      </div>
      {mode === 'solid' && (
        <PaintControl
          label="Background color"
          value={color}
          update={(color) => styleChange('backgroundColor', color)}
        />
      )}
      {mode === 'gradient' && (
        <PaintControl
          label="Background gradient"
          value={gradient}
          gradient
          update={(gradient) => styleChange('backgroundImage', gradient)}
        />
      )}
      {mode === 'image' && (
        <>
          {renderMedia?.(value, update)}
          <label>
            Background image URL
            <input
              type="text"
              key={value.imageURL}
              defaultValue={value.imageURL ?? ''}
              onBlur={(event) => update({ imageURL: event.target.value })}
            />
          </label>
          <FocalPoint
            url={value.imageURL}
            value={value.position ?? '50% 50%'}
            update={(position) => update({ position })}
          />
          <label>
            Image fit
            <select
              value={value.fit ?? 'cover'}
              onChange={(event) => update({ fit: event.target.value as 'cover' })}
            >
              {['cover', 'contain', 'auto'].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Image repeat
            <select
              value={value.repeat ?? 'no-repeat'}
              onChange={(event) => update({ repeat: event.target.value as 'no-repeat' })}
            >
              {['no-repeat', 'repeat', 'repeat-x', 'repeat-y'].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        </>
      )}
      <PaintControl
        label="Overlay color"
        value={value.overlay ?? ''}
        update={(overlay) => update({ overlay, gradient: '', opacity: value.opacity ?? 1 })}
      />
      <PaintControl
        label="Overlay gradient"
        value={value.gradient ?? ''}
        gradient
        update={(gradient) => update({ gradient, opacity: value.opacity ?? 1 })}
      />
      <label>
        Overlay opacity
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value.opacity ?? 0}
          onChange={(event) => update({ opacity: Number(event.target.value) })}
        />
      </label>
      <label>
        Overlay blend mode
        <select
          value={value.blendMode ?? 'normal'}
          onChange={(event) => update({ blendMode: event.target.value as 'normal' })}
        >
          {['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
      <button type="button" onClick={reset}>
        Reset {device} background
      </button>
      {device !== 'desktop' && !background?.responsive?.[device] && (
        <small>Inherited from larger devices</small>
      )}
    </details>
  )
}
