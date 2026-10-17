'use client'
import './inspector-tabs.css'
import { Maximize2 } from 'lucide-react'

export function InspectorTabs({
  value,
  onChange,
  documentLabel,
  onExpand,
}: {
  value: 'block' | 'document'
  onChange: (value: 'block' | 'document') => void
  documentLabel: string
  onExpand?: () => void
}) {
  return (
    <div className="editor-inspector-heading">
      <div className="editor-inspector-tabs" role="tablist" aria-label="Inspector tabs">
        {(['block', 'document'] as const).map((tab, index) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={value === tab}
            tabIndex={value === tab ? 0 : -1}
            aria-label={tab === 'document' ? 'Document settings' : undefined}
            title={tab === 'document' ? 'Document settings' : undefined}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
              onChange(next === 0 ? 'block' : 'document')
              ;(
                event.currentTarget.parentElement?.querySelectorAll('button')[
                  next
                ] as HTMLButtonElement
              )?.focus()
            }}
          >
            {tab === 'block' ? 'Block' : documentLabel}
          </button>
        ))}
      </div>
      {onExpand && (
        <button
          type="button"
          className="editor-inspector-expand"
          aria-label="Expand inspector"
          title="Expand inspector"
          onClick={onExpand}
        >
          <Maximize2 size={17} />
        </button>
      )}
    </div>
  )
}
