'use client'

import type { ReactNode } from 'react'

export function BuilderWorkspace({
  canvas,
  canvasLabel,
  canvasTitle,
  inspector,
  inspectorTitle,
  library,
  libraryNavigation,
  libraryOpen,
  libraryTitle,
  onLibraryOpenChange,
}: {
  canvas: ReactNode
  canvasLabel: string
  canvasTitle: string
  inspector: ReactNode
  inspectorTitle: string
  library: ReactNode
  libraryNavigation: ReactNode
  libraryOpen: boolean
  libraryTitle: string
  onLibraryOpenChange: (open: boolean) => void
}) {
  return <>
    <button type="button" className="template-editor__toggle" aria-expanded={libraryOpen} aria-controls="template-element-library" onClick={() => onLibraryOpenChange(!libraryOpen)}>☰ {libraryOpen ? 'Hide' : 'Show'} editor sidebar</button>
    <div className="template-editor__workspace" data-library={libraryOpen ? 'open' : 'closed'}>
      {libraryOpen && <aside id="template-element-library" className="template-editor__sidebar template-editor__sidebar--left" aria-label="Element Library"><div className="template-editor__sidebar-inner"><div className="template-editor__sidebar-header"><h2>{libraryTitle}</h2><button type="button" className="template-editor__icon-button" aria-label="Close Element Library" onClick={() => onLibraryOpenChange(false)}>×</button></div>{libraryNavigation}{library}</div></aside>}
      <main aria-label={canvasLabel} className="template-editor__canvas"><div className="template-editor__canvas-header"><h2>{canvasTitle}</h2></div>{canvas}</main>
      <aside aria-label="Configure panel" className="template-editor__sidebar template-editor__sidebar--right"><div className="template-editor__sidebar-inner"><div className="template-editor__sidebar-header"><h2>{inspectorTitle}</h2></div>{inspector}</div></aside>
    </div>
  </>
}
