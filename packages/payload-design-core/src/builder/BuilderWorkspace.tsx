'use client'

import { useEffect, useState, type ReactNode } from 'react'

/** Layout shared by content authoring, locked templates and template design adapters. */
export function BuilderPanels({ children, className, leftOpen, rightOpen }: { children: ReactNode; className: string; leftOpen: boolean; rightOpen: boolean }) {
  return <div className={className} data-left={leftOpen} data-right={rightOpen} data-library={leftOpen ? 'open' : 'closed'} data-inspector={rightOpen ? 'open' : 'closed'}>{children}</div>
}

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
  documentSettings,
  selectionKey,
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
  documentSettings?: ReactNode
  selectionKey?: string
}) {
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [tab, setTab] = useState<'block' | 'document'>('block')
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize the inspector with selection owned by the document adapter.
  useEffect(() => { if (selectionKey) { setTab('block'); setInspectorOpen(true) } }, [selectionKey])
  return <>
    <button type="button" className="template-editor__toggle" aria-expanded={libraryOpen} aria-controls="template-element-library" onClick={() => onLibraryOpenChange(!libraryOpen)}>☰ {libraryOpen ? 'Hide' : 'Show'} editor sidebar</button>
    <button type="button" className="template-editor__toggle" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}>Inspector</button>
    <BuilderPanels className="template-editor__workspace" leftOpen={libraryOpen} rightOpen={inspectorOpen}>
      {libraryOpen && <aside id="template-element-library" className="template-editor__sidebar template-editor__sidebar--left" aria-label="Element Library"><div className="template-editor__sidebar-inner"><div className="template-editor__sidebar-header"><h2>{libraryTitle}</h2><button type="button" className="template-editor__icon-button" aria-label="Close Element Library" onClick={() => onLibraryOpenChange(false)}>×</button></div>{libraryNavigation}{library}</div></aside>}
      <main aria-label={canvasLabel} className="template-editor__canvas">{canvasTitle && <div className="template-editor__canvas-header"><h2>{canvasTitle}</h2></div>}{canvas}</main>
      {inspectorOpen && <aside aria-label="Configure panel" className="template-editor__sidebar template-editor__sidebar--right"><div className="template-editor__sidebar-inner"><div className="template-editor__sidebar-header"><h2>{inspectorTitle}</h2><button type="button" aria-label="Close inspector" onClick={() => setInspectorOpen(false)}>×</button></div>{documentSettings && <div role="tablist" aria-label="Inspector"><button type="button" role="tab" aria-selected={tab==='block'} onClick={()=>setTab('block')}>Block</button><button type="button" role="tab" aria-label="Document settings" title="Document settings" aria-selected={tab==='document'} onClick={()=>setTab('document')}>⚙</button></div>}{tab==='document'&&documentSettings ? documentSettings : inspector}</div></aside>}
    </BuilderPanels>
  </>
}
