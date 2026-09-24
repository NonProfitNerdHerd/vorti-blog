'use client'

import type { BuilderPreviewSize, BuilderViewport } from './contracts'

export const BUILDER_PREVIEW_SIZES: Record<BuilderViewport, BuilderPreviewSize> = {
  desktop: { viewport: 'desktop', width: 1440, height: 900 },
  tablet: { viewport: 'tablet', width: 768, height: 1024 },
  mobile: { viewport: 'mobile', width: 390, height: 844 },
}

export function BuilderPreviewToolbar({ value, onChange }: { value: BuilderViewport; onChange: (value: BuilderViewport) => void }) {
  return <div role="toolbar" aria-label="Responsive preview" className="template-editor__preview-toolbar">
    {(Object.keys(BUILDER_PREVIEW_SIZES) as BuilderViewport[]).map((viewport) => <button key={viewport} type="button" aria-pressed={value === viewport} onClick={() => onChange(viewport)}>{viewport[0].toUpperCase() + viewport.slice(1)}</button>)}
  </div>
}

export function BuilderPreviewFrame({ children, viewport }: { children: React.ReactNode; viewport: BuilderViewport }) {
  const size = BUILDER_PREVIEW_SIZES[viewport]
  return <div className="template-editor__preview-frame" data-viewport={viewport} style={{ maxWidth: `min(100%, ${size.width}px)` }}>{children}</div>
}
