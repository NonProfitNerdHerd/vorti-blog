'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { InspectorDevice, InspectorToggle } from './InspectorControls'
import type { Viewport } from '../content/model'
import { BlockInspectorStateProvider } from './UnifiedBlockInspector'

/** Layout shared by content authoring, locked templates and template design adapters. */
export function BuilderPanels({
  children,
  className,
  leftOpen,
  rightOpen,
  viewport = 'desktop',
  onViewportChange = () => {},
}: {
  children: ReactNode
  className: string
  leftOpen: boolean
  rightOpen: boolean
  viewport?: Viewport
  onViewportChange?: (value: Viewport) => void
}) {
  return (
    <div
      className={className}
      data-left={leftOpen}
      data-right={rightOpen}
      data-library={leftOpen ? 'open' : 'closed'}
      data-inspector={rightOpen ? 'open' : 'closed'}
    >
      <InspectorDevice.Provider value={{ viewport, change: onViewportChange }}>
        <BlockInspectorStateProvider>{children}</BlockInspectorStateProvider>
      </InspectorDevice.Provider>
    </div>
  )
}

export function BuilderWorkspace({
  canvas,
  canvasLabel,
  canvasTitle,
  inspector,
  documentLabel = 'Template',
  viewport,
  onViewportChange,
  library,
  libraryNavigation,
  libraryOpen,
  libraryTitle,
  onLibraryOpenChange,
  documentSettings,
  selectionKey,
  sidebar,
  sidebarControls,
  readOnly,
}: {
  canvas: ReactNode
  canvasLabel: string
  canvasTitle: string
  inspector: ReactNode
  documentLabel?: string
  viewport?: Viewport
  onViewportChange?: (value: Viewport) => void
  inspectorTitle: string
  library: ReactNode
  libraryNavigation: ReactNode
  libraryOpen: boolean
  libraryTitle: string
  onLibraryOpenChange: (open: boolean) => void
  documentSettings?: ReactNode
  selectionKey?: string
  sidebar?: ReactNode
  sidebarControls?: ReactNode
  readOnly?: boolean
}) {
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [tab, setTab] = useState<'block' | 'document'>('block')
  useEffect(() => {
    if (selectionKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize the adapter-owned selection.
      setTab('block')
      setInspectorOpen(true)
    }
  }, [selectionKey])
  return (
    <>
      {sidebarControls ?? (
        <button
          type="button"
          className="template-editor__toggle"
          aria-expanded={libraryOpen}
          aria-controls="template-element-library"
          onClick={() => onLibraryOpenChange(!libraryOpen)}
        >
          ☰ {libraryOpen ? 'Hide' : 'Show'} editor sidebar
        </button>
      )}
      <InspectorToggle open={inspectorOpen} change={setInspectorOpen} />
      <BuilderPanels
        className="template-editor__workspace"
        leftOpen={libraryOpen}
        rightOpen={inspectorOpen}
        viewport={viewport}
        onViewportChange={onViewportChange}
      >
        {libraryOpen && (
          <aside
            id="template-element-library"
            className="template-editor__sidebar template-editor__sidebar--left"
            aria-label="Element Library"
          >
            <div className="template-editor__sidebar-inner">
              {sidebar ?? (
                <>
                  <div className="template-editor__sidebar-header">
                    <h2>{libraryTitle}</h2>
                    <button
                      type="button"
                      className="template-editor__icon-button"
                      aria-label="Close Element Library"
                      onClick={() => onLibraryOpenChange(false)}
                    >
                      ×
                    </button>
                  </div>
                  {libraryNavigation}
                  {library}
                </>
              )}
            </div>
          </aside>
        )}
        <main aria-label={canvasLabel} className="template-editor__canvas">
          {canvasTitle && (
            <div className="template-editor__canvas-header">
              <h2>{canvasTitle}</h2>
            </div>
          )}
          {canvas}
        </main>
        {inspectorOpen && (
          <aside
            aria-label="Configure panel"
            className="template-editor__sidebar template-editor__sidebar--right"
          >
            <div className="template-editor__sidebar-inner">
              {documentSettings && (
                <div role="tablist" aria-label="Inspector">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'block'}
                    onClick={() => setTab('block')}
                  >
                    Block
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-label="Document settings"
                    title="Document settings"
                    aria-selected={tab === 'document'}
                    onClick={() => setTab('document')}
                  >
                    {documentLabel}
                  </button>
                </div>
              )}
              <fieldset
                disabled={readOnly}
                style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              >
                {tab === 'document' && documentSettings ? documentSettings : inspector}
              </fieldset>
            </div>
          </aside>
        )}
      </BuilderPanels>
    </>
  )
}
