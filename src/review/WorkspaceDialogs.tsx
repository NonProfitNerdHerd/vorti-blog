'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Initialize form inputs when a queued dialog request becomes active. */
import { useEffect, useRef, useState } from 'react'
import { EditorDialog } from '@design-system/payload-design-core/admin'
import './projects.css'

type InputField = {
  name: string
  label: string
  value?: string
  type?: 'text' | 'number' | 'date' | 'datetime-local' | 'textarea' | 'weekdays'
  required?: boolean
  min?: number
  max?: number
}
type DialogOptions = {
  title: string
  description?: string
  fields: InputField[]
  saveLabel?: string
  onSave: (values: Record<string, string>) => Promise<void>
}
type Request = DialogOptions & { resolve: (saved: boolean) => void }
export function workspaceDialog(options: DialogOptions) {
  return new Promise<boolean>((resolve) =>
    window.dispatchEvent(
      new CustomEvent('vorti-workspace-dialog', { detail: { ...options, resolve } }),
    ),
  )
}
export function WorkspaceDialogs() {
  const [queue, setQueue] = useState<Request[]>([]),
    [values, setValues] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    pending = useRef<Request[]>([]),
    active = queue[0]
  useEffect(() => {
    const open = (event: Event) =>
      setQueue((items) => [...items, (event as CustomEvent<Request>).detail])
    window.addEventListener('vorti-workspace-dialog', open)
    return () => {
      window.removeEventListener('vorti-workspace-dialog', open)
      for (const request of pending.current) request.resolve(false)
    }
  }, [])
  useEffect(() => {
    pending.current = queue
    setError('')
    setValues(
      Object.fromEntries((active?.fields ?? []).map((field) => [field.name, field.value ?? ''])),
    )
  }, [active])
  if (!active) return null
  const close = (saved = false) => {
    active.resolve(saved)
    setQueue((items) => items.slice(1))
  }
  const change = (name: string, value: string) =>
    setValues((values) => ({ ...values, [name]: value }))
  return (
    <EditorDialog
      open
      title={active.title}
      onClose={() => {
        if (!busy) close()
      }}
    >
      <div
        className="workspace-settings"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
            event.preventDefault()
        }}
      >
        {active.description && <p>{active.description}</p>}
        {error && <p role="alert">{error}</p>}
        <fieldset disabled={busy} className="workspace-dialog-fields">
          {active.fields.map((field) =>
            field.type === 'weekdays' ? (
              <fieldset key={field.name}>
                <legend>{field.label}</legend>
                <div className="workspace-weekdays">
                  {[
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                  ].map((day, index) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        checked={(values[field.name] ?? '').split(',').includes(String(index))}
                        onChange={(event) => {
                          const selected = (values[field.name] ?? '')
                            .split(',')
                            .filter(Boolean)
                            .filter((value) => value !== String(index))
                          if (event.target.checked) selected.push(String(index))
                          change(field.name, selected.join(','))
                        }}
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <label key={field.name}>
                {field.label}
                {field.type === 'textarea' ? (
                  <textarea
                    value={values[field.name] ?? ''}
                    onChange={(event) => change(field.name, event.target.value)}
                  />
                ) : (
                  <input
                    type={field.type ?? 'text'}
                    step={
                      field.type === 'datetime-local'
                        ? 1
                        : field.type === 'number'
                          ? 'any'
                          : undefined
                    }
                    min={field.min}
                    max={field.max}
                    required={field.required}
                    value={values[field.name] ?? ''}
                    onChange={(event) => change(field.name, event.target.value)}
                  />
                )}
              </label>
            ),
          )}
        </fieldset>
        <div className="task-workspace-toolbar">
          <button
            type="button"
            className="task-primary"
            disabled={busy}
            onClick={async () => {
              for (const field of active.fields) {
                const value = values[field.name] ?? ''
                if (field.required && !value.trim()) {
                  setError(`${field.label} is required.`)
                  return
                }
                if (
                  field.type === 'number' &&
                  (!Number.isFinite(Number(value)) ||
                    (field.min !== undefined && Number(value) < field.min) ||
                    (field.max !== undefined && Number(value) > field.max))
                ) {
                  setError(`Enter a valid ${field.label.toLowerCase()}.`)
                  return
                }
              }
              setBusy(true)
              setError('')
              try {
                await active.onSave(values)
                close(true)
              } catch (error) {
                setError((error as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : (active.saveLabel ?? 'Save')}
          </button>
          <button type="button" disabled={busy} onClick={() => close()}>
            Cancel
          </button>
        </div>
      </div>
    </EditorDialog>
  )
}
