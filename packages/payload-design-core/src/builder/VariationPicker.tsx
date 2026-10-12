'use client'
import type { ContentNode } from '../content/model'
import { applyVariation, variationsFor } from '../blocks/variations'
import './variations-editor.css'
import { beginInspectorGesture, endInspectorGesture } from './InspectorControls'
export function VariationPicker({
  node,
  onChange,
  onDone,
  initial = false,
  disabled = false,
}: {
  node: ContentNode
  onChange: (node: ContentNode) => void
  onDone?: () => void
  initial?: boolean
  disabled?: boolean
}) {
  const variations = variationsFor(node.kind)
  if (!variations.length) return null
  const choose = (id: string) => {
    beginInspectorGesture()
    try {
      onChange(applyVariation(node, id))
    } finally {
      endInspectorGesture()
    }
    onDone?.()
  }
  return (
    <div className="block-variation-picker" onClick={(e) => e.stopPropagation()}>
      <p>{initial ? 'Select a variation to start with' : 'Layout variations'}</p>
      <div role="group" aria-label={`${node.label ?? node.kind} variations`}>
        {variations.map((variation, index) => (
          <button
            key={variation.id}
            type="button"
            disabled={disabled}
            aria-pressed={node.variation?.id === variation.id}
            onClick={() => choose(variation.id)}
            onKeyDown={(e) => {
              const next =
                e.key === 'ArrowRight'
                  ? index + 1
                  : e.key === 'ArrowLeft'
                    ? index - 1
                    : e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? variations.length - 1
                        : -1
              if (next >= 0) {
                e.preventDefault()
                const buttons = e.currentTarget.parentElement?.querySelectorAll('button')
                ;(buttons?.[next % variations.length] as HTMLButtonElement)?.focus()
              }
            }}
          >
            <svg width="64" height="44" viewBox="0 0 64 44" aria-hidden="true">
              <rect x="2" y="2" width="60" height="40" rx="2" fill="none" stroke="currentColor" />
              {variation.thumbnail === 'split' ? (
                <>
                  <rect x="5" y="5" width="25" height="34" fill="currentColor" opacity=".25" />
                  <path d="M35 12h20M35 18h17M35 27h12" stroke="currentColor" />
                </>
              ) : variation.thumbnail === 'overlay' ? (
                <>
                  <rect x="5" y="5" width="54" height="34" fill="currentColor" opacity=".25" />
                  <rect
                    x={index % 2 ? 20 : 10}
                    y="14"
                    width="32"
                    height="19"
                    fill="var(--theme-bg,#fff)"
                  />
                  <path d="M24 19h13M24 25h10" stroke="currentColor" />
                </>
              ) : variation.thumbnail === 'grid' ? (
                <>
                  {[8, 25, 42].map((x) => (
                    <rect
                      key={x}
                      x={x}
                      y={index % 2 ? 10 + (x % 3) * 3 : 10}
                      width="13"
                      height="25"
                      fill="currentColor"
                      opacity=".4"
                    />
                  ))}
                </>
              ) : (
                <>
                  <rect x="8" y="6" width="48" height="15" fill="currentColor" opacity=".25" />
                  <path d="M10 27h42M10 33h30" stroke="currentColor" />
                </>
              )}
            </svg>
            <span>{variation.label}</span>
          </button>
        ))}
      </div>
      {initial && (
        <button type="button" disabled={disabled} onClick={() => choose(variations[0].id)}>
          Skip
        </button>
      )}
    </div>
  )
}
