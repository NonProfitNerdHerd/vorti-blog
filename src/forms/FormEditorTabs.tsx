'use client'

import { RenderFields, type GroupField } from '@payloadcms/ui'
import { getFieldPaths } from 'payload/shared'
import { useId, useState, type ComponentProps } from 'react'
import './form-editor.css'
import { FormTransferHost } from './FormTransferHost'

/** Unnamed tabs retain the existing field paths. Visited panels stay mounted. */
export function FormEditorTabs({ field, indexPath = '', path = '', schemaPath = '', permissions, readOnly }: ComponentProps<typeof GroupField>) {
  const tabs = field.fields.filter(field => field.type === 'group')
  const [active, setActive] = useState(0)
  const [visited, setVisited] = useState([0])
  const id = useId()
  const [transferHost, setTransferHost] = useState<HTMLDivElement | null>(null)
  const select = (index: number) => { setActive(index); setVisited(old => old.includes(index) ? old : [...old, index]) }
  return <FormTransferHost.Provider value={transferHost}><div className="form-editor">
    <div role="tablist" aria-label="Form workspace" className="form-editor-tabs">
      {tabs.map((tab, index) => <button key={index} className={tab.label === 'Import / Export' ? 'form-transfer-tab' : undefined} type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={active === index} tabIndex={active === index ? 0 : -1}
        onClick={() => select(index)} onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : undefined
          if (next === undefined) return
          event.preventDefault(); select(next); document.getElementById(`${id}-tab-${next}`)?.focus()
        }}>{String(tab.label)}</button>)}
    </div>
    {tabs.map((tab, index) => {
      const paths = getFieldPaths({ field: tab, index, parentIndexPath: indexPath, parentPath: path, parentSchemaPath: schemaPath })
      return <section key={index} role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} hidden={active !== index}>
        {tab.label === 'Import / Export' ? <div ref={setTransferHost} className="forms-builder form-transfer-host" /> : visited.includes(index) && <RenderFields forceRender fields={tab.fields} parentIndexPath={paths.indexPath} parentPath={paths.path} parentSchemaPath={paths.schemaPath} permissions={permissions} readOnly={readOnly} />}
      </section>
    })}
  </div></FormTransferHost.Provider>
}
