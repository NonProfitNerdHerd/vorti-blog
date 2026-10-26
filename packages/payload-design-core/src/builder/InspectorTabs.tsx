'use client'
import './inspector-tabs.css'
import { Maximize2 } from 'lucide-react'

export type InspectorTab = 'block' | 'document' | 'seo'

export function InspectorTabs({
  value,
  onChange,
  documentLabel,
  onExpand,
  seo = false,
}: {
  value: InspectorTab
  onChange: (value: InspectorTab) => void
  documentLabel: string
  onExpand?: () => void
  seo?: boolean
}) {
  const tabs: InspectorTab[] = seo ? ['block', 'document', 'seo'] : ['block', 'document']
  return (
    <div className="editor-inspector-heading">
      <div className="editor-inspector-tabs" role="tablist" aria-label="Inspector tabs">
        {tabs.map((tab, index) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={value === tab}
            tabIndex={value === tab ? 0 : -1}
            aria-label={tab === 'document' ? 'Document settings' : tab === 'seo' ? 'SEO' : undefined}
            title={tab === 'document' ? 'Document settings' : tab === 'seo' ? 'SEO settings' : undefined}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
              onChange(tabs[next])
              ;(
                event.currentTarget.parentElement?.querySelectorAll('button')[
                  next
                ] as HTMLButtonElement
              )?.focus()
            }}
          >
            {tab === 'block' ? 'Block' : tab === 'seo' ? 'SEO' : documentLabel}
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
