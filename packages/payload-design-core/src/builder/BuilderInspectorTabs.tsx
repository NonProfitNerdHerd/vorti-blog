'use client'

export type BuilderInspectorTab = 'settings' | 'style' | 'advanced'

export function BuilderInspectorTabs({ active, onChange, settingsLabel = 'Settings' }: {
  active: BuilderInspectorTab
  onChange: (tab: BuilderInspectorTab) => void
  settingsLabel?: string
}) {
  const button = (name: BuilderInspectorTab, text: string) => (
    <button type="button" role="tab" aria-selected={active === name} onClick={() => onChange(name)} style={{ padding: '9px 6px', border: 0, borderBottom: active === name ? '2px solid var(--theme-success-500)' : '2px solid transparent', background: 'transparent' }}>{text}</button>
  )
  return <div role="tablist" aria-label="Element settings" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 18, borderBottom: '1px solid var(--theme-elevation-150)' }}>{button('settings', settingsLabel)}{button('style', 'Style')}{button('advanced', 'Advanced')}</div>
}
