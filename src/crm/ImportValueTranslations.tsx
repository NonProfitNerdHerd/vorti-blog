'use client'
import type { ImportColumnMapping } from './import-model'
import { ImportSourceValues } from './ImportSourceValues'
type Props = {
  column: ImportColumnMapping
  label: string
  onChange: (column: ImportColumnMapping) => void
  onChoose?: (index: number) => void
  source?: { api: string; site: string; run: string; onDenied: () => void }
}
export function ImportValueTranslations({ column, label, onChange, onChoose, source }: Props) {
  const entries = column.translations
  if (!entries)
    return (
      <button
        type="button"
        onClick={() =>
          onChange({ ...column, translations: [{ source: '', value: '' }], unmatched: 'error' })
        }
      >
        Translate {label.toLowerCase()} values
      </button>
    )
  return (
    <section aria-label={`${label} value translations`}>
      <p>
        Match original values exactly, including case and spaces. Blank source cells still follow
        the selected preserve/clear behavior.
      </p>
      {source && column.column !== undefined && (
        <ImportSourceValues
          {...source}
          column={column.column}
          selected={entries.map((entry) => entry.source)}
          canAdd={entries.length < 1000 || entries.some((entry) => !entry.source.trim())}
          onChoose={(value) => {
            const blank = entries.findIndex((entry) => !entry.source.trim())
            onChange({
              ...column,
              translations:
                blank >= 0
                  ? entries.map((entry, index) =>
                      index === blank ? { ...entry, source: value } : entry,
                    )
                  : [...entries, { source: value, value: '' }],
            })
          }}
        />
      )}
      <label>
        Unmatched {label.toLowerCase()} values
        <select
          value={column.unmatched || 'error'}
          onChange={(event) =>
            onChange({ ...column, unmatched: event.target.value as 'error' | 'source' })
          }
        >
          <option value="error">Require a reviewed translation</option>
          <option value="source">Use the original source value</option>
        </select>
      </label>
      {entries.map((entry, index) => (
        <div key={index}>
          <label>
            {label} original value {index + 1}
            <input
              value={entry.source}
              maxLength={32768}
              onChange={(event) =>
                onChange({
                  ...column,
                  translations: entries.map((pair, position) =>
                    position === index ? { ...pair, source: event.target.value } : pair,
                  ),
                })
              }
            />
          </label>
          <label>
            {label} translated value {index + 1}
            <input
              value={entry.value}
              maxLength={32768}
              onChange={(event) =>
                onChange({
                  ...column,
                  translations: entries.map((pair, position) =>
                    position === index ? { ...pair, value: event.target.value } : pair,
                  ),
                })
              }
            />
          </label>
          {onChoose && column.referenceMode === 'record' && (
            <button type="button" onClick={() => onChoose(index)}>
              Choose {label.toLowerCase()} for value {index + 1}
            </button>
          )}
          <button
            type="button"
            disabled={entries.length === 1}
            onClick={() =>
              onChange({
                ...column,
                translations: entries.filter((_, position) => position !== index),
              })
            }
          >
            Remove {label.toLowerCase()} translation {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={entries.length >= 1000}
        onClick={() =>
          onChange({ ...column, translations: [...entries, { source: '', value: '' }] })
        }
      >
        Add {label.toLowerCase()} translation
      </button>
      {entries.length >= 1000 && <p>A field supports up to 1,000 explicit translations.</p>}
      <button
        type="button"
        onClick={() => {
          const next = { ...column }
          delete next.translations
          delete next.unmatched
          onChange(next)
        }}
      >
        Stop translating {label.toLowerCase()} values
      </button>
    </section>
  )
}
