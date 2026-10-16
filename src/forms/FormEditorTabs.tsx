'use client'

import { RenderFields, useFormFields, useFormSubmitted, type GroupField } from '@payloadcms/ui'
import { getFieldPaths } from 'payload/shared'
import { useId, useState, type ComponentProps } from 'react'
import './form-editor.css'
import { FormEmailHost, FormTransferHost, FormWorkspaceNavigation } from './FormTransferHost'

const builderViews = ['Build', 'Logic', 'Design', 'Actions', 'Access', 'Publish', 'Preview']

/** Unnamed groups retain field paths; the one builder stays mounted across every view. */
export function FormEditorTabs({ field, indexPath = '', path = '', schemaPath = '', permissions, readOnly }: ComponentProps<typeof GroupField>) {
  const tabs = field.fields.filter(field => field.type === 'group')
  const [view, setView] = useState('Build')
  const [visited, setVisited] = useState(['Build', 'Details'])
  const id = useId()
  const [transferHost, setTransferHost] = useState<HTMLDivElement | null>(null)
  const [emailHost, setEmailHost] = useState<HTMLDivElement | null>(null)
  const submitted = useFormSubmitted()
  const formFields = useFormFields(([fields]) => fields)
  const errors = Object.entries(formFields).filter(([, state]) => state.valid === false && state.errorMessage).map(([path, state]) => ({ path, message: String(state.errorMessage) }))
  const select = (next: string) => { setView(next); setVisited(old => old.includes(next) ? old : [...old, next]) }
  const active = tabs.findIndex(tab => tab.label === view)
  const internal = builderViews.includes(view)
  const repair = (fieldPath: string) => {
    select(fieldPath === 'title' || fieldPath.startsWith('definition') ? 'Build' : 'Details')
    requestAnimationFrame(() => document.getElementById(id)?.closest('.collection-edit')?.querySelector<HTMLElement>(`[name="${CSS.escape(fieldPath)}"]`)?.focus())
  }
  return <FormWorkspaceNavigation.Provider value={{ view, onChange: select }}><FormEmailHost.Provider value={{ target: emailHost, open: () => select('Email') }}><FormTransferHost.Provider value={transferHost}><div id={id} className="form-editor">
    <div role="tablist" aria-label="Form workspace" className="form-editor-tabs">
      {tabs.map((tab, index) => <button key={index} className={tab.label === 'Import / Export' ? 'form-transfer-tab' : undefined} type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${builderViews.includes(String(tab.label)) ? 0 : index}`} aria-selected={active === index} tabIndex={active === index || (active === -1 && index === 0) ? 0 : -1}
        onClick={() => select(String(tab.label))} onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : undefined
          if (next === undefined) return
          event.preventDefault(); select(String(tabs[next].label)); document.getElementById(`${id}-tab-${next}`)?.focus()
        }}>{String(tab.label)}</button>)}
    </div>
    {submitted && errors.length > 0 && <div role="alert" className="forms-legacy-review"><p>Correct these settings before saving:</p><ul>{errors.map(error => <li key={error.path}><button type="button" onClick={() => repair(error.path)}>{error.path}: {error.message}</button></li>)}</ul></div>}
    {tabs.map((tab, index) => {
      if (index > 0 && builderViews.includes(String(tab.label))) return null
      const paths = getFieldPaths({ field: tab, index, parentIndexPath: indexPath, parentPath: path, parentSchemaPath: schemaPath })
      return <section key={index} role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={index === 0 && active >= 0 && internal ? `${id}-tab-${active}` : index === 0 && active === -1 ? undefined : `${id}-tab-${index}`} aria-label={index === 0 && active === -1 ? view === 'Preview' ? 'Try form' : 'Publish readiness' : undefined} hidden={index === 0 ? !internal : active !== index}>
        {tab.label === 'Email' ? <div ref={setEmailHost} className="forms-builder form-transfer-host" /> : tab.label === 'Import / Export' ? <div ref={setTransferHost} className="forms-builder form-transfer-host" /> : visited.includes(String(tab.label)) && <RenderFields forceRender fields={tab.fields} parentIndexPath={paths.indexPath} parentPath={paths.path} parentSchemaPath={paths.schemaPath} permissions={permissions} readOnly={readOnly} />}
      </section>
    })}
  </div></FormTransferHost.Provider></FormEmailHost.Provider></FormWorkspaceNavigation.Provider>
}
