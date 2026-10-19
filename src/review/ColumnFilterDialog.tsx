'use client'
import { useState } from 'react'
import { EditorDialog } from '@design-system/payload-design-core/admin'
import type { ColumnFilter } from './board-columns'
export function ColumnFilterDialog({
  name,
  kind,
  options = [],
  value,
  onSave,
  onClose,
}: {
  name: string
  kind: string
  options?: { value: string; label: string }[]
  value?: ColumnFilter
  onSave: (value?: ColumnFilter) => Promise<void>
  onClose: () => void
}) {
  const [operator, setOperator] = useState(
      value?.operator ??
        (options.length || ['number', 'time-tracking', 'timer', 'date'].includes(kind)
          ? 'eq'
          : 'contains'),
    ),
    [text, setText] = useState(value?.value ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const numeric = ['number', 'time-tracking', 'timer'].includes(kind),
    date = kind === 'date'
  return (
    <EditorDialog open title={`Filter ${name}`} onClose={onClose}>
      <div className="workspace-settings">
        <label>
          Condition
          <select value={operator} onChange={(event) => setOperator(event.target.value)}>
            {[
              ['eq', 'Is'],
              ['not-eq', 'Is not'],
              ...(!options.length && !numeric && !date ? [['contains', 'Contains']] : []),
              ...(!options.length && (numeric || date || kind === 'formula' || kind === 'lookup')
                ? [
                    ['gt', 'Greater than / after'],
                    ['gte', 'At least / on or after'],
                    ['lt', 'Less than / before'],
                    ['lte', 'At most / on or before'],
                  ]
                : []),
              ['empty', 'Is empty'],
              ['not-empty', 'Is not empty'],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!['empty', 'not-empty'].includes(operator) && (
          <label>
            Value
            {options.length ? (
              <select value={text} onChange={(event) => setText(event.target.value)}>
                <option value="">Choose…</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={date ? 'date' : numeric ? 'number' : 'text'}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            )}
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          className="task-primary"
          disabled={busy}
          onClick={async () => {
            if (
              !['empty', 'not-empty'].includes(operator) &&
              (!text || (numeric && !Number.isFinite(Number(text))))
            ) {
              setError('Enter a valid filter value.')
              return
            }
            setBusy(true)
            try {
              await onSave({ operator, value: text })
              onClose()
            } catch (error) {
              setError((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          Apply filter
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave()
              onClose()
            } catch (error) {
              setError((error as Error).message)
              setBusy(false)
            }
          }}
        >
          Clear filter
        </button>
      </div>
    </EditorDialog>
  )
}
