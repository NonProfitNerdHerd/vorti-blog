'use client'
import './inspector-tabs.css'

export function InspectorTabs({ value, onChange, documentLabel }: { value: 'block' | 'document'; onChange: (value: 'block' | 'document') => void; documentLabel: string }) {
  return <div className="editor-inspector-tabs" role="tablist" aria-label="Inspector tabs">
    {(['block', 'document'] as const).map((tab, index) => <button key={tab} type="button" role="tab" aria-selected={value === tab} tabIndex={value === tab ? 0 : -1} aria-label={tab === 'document' ? 'Document settings' : undefined} title={tab === 'document' ? 'Document settings' : undefined} onClick={() => onChange(tab)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
      onChange(next === 0 ? 'block' : 'document')
      ;(event.currentTarget.parentElement?.querySelectorAll('button')[next] as HTMLButtonElement)?.focus()
    }}>{tab === 'block' ? 'Block' : documentLabel}</button>)}
  </div>
}
