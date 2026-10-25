'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import {
  importFields,
  importHeadersMatch,
  importMapping,
  type ImportColumnMapping,
  type ImportDomain,
  type ImportMapping,
} from './import-model'
import type { SavedImportMapping } from './import-mappings'
import { ImportReferenceMatch } from './ImportReferenceMatch'
import { ImportContactMatch } from './ImportContactMatch'
import { ImportValueTranslations } from './ImportValueTranslations'

type Props = {
  api: string
  site: string
  domain: ImportDomain
  runID?: string
  headers: string[]
  mapping: ImportMapping | null
  onConfigured: (mapping: ImportMapping) => Promise<void>
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
  onDenied: () => void
}
type Page = { docs: SavedImportMapping[]; total: number; next: string | null; canEdit: boolean }
export function ImportMappingEditor(props: Props) {
  return (
    <MappingEditor
      key={`${props.site}:${props.domain}:${JSON.stringify(props.headers)}`}
      {...props}
    />
  )
}
function MappingEditor({
  api,
  site,
  domain,
  runID,
  headers,
  mapping,
  onConfigured,
  onDirty,
  onSaving,
  onDenied,
}: Props) {
  const [matchingField, setMatchingField] = useState('')
  const [matchingTranslation, setMatchingTranslation] = useState<{
    index: number
    source: string
  } | null>(null)
  const [columns, setColumns] = useState<ImportColumnMapping[]>(
    mapping && importHeadersMatch(mapping, headers) ? mapping.columns : [],
  )
  const [saved, setSaved] = useState<SavedImportMapping[]>([]),
    [next, setNext] = useState<string | null>(null),
    [after, setAfter] = useState(''),
    [archived, setArchived] = useState(false),
    [canEdit, setCanEdit] = useState(false)
  const [selected, setSelected] = useState<SavedImportMapping | null>(null),
    [selectedID, setSelectedID] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [refresh, setRefresh] = useState(0)
  const [runDirty, setRunDirty] = useState(false),
    [nameDirty, setNameDirty] = useState(false)
  const operation = useRef<{ fingerprint: string; key: string } | null>(null),
    generation = useRef(0),
    alive = useRef(true),
    callbacks = useRef({ onDirty, onSaving, onDenied })
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    callbacks.current = { onDirty, onSaving, onDenied }
  }, [onDirty, onSaving, onDenied])
  const deny = useCallback((cause: unknown) => {
    if (![401, 403, 404].includes(Number((cause as { status?: number })?.status))) return
    setColumns([])
    setSaved([])
    setSelected(null)
    setSelectedID('')
    setName('')
    setCanEdit(false)
    setNotice('')
    operation.current = null
    setRunDirty(false)
    setNameDirty(false)
    callbacks.current.onDirty(false)
    callbacks.current.onDenied()
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const version = ++generation.current
    void crmRead<Page>(
      `${api}/crm/import-mappings?${new URLSearchParams({ site, domain, after, archived: String(archived) })}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (controller.signal.aborted || version !== generation.current) return
        setSaved((previous) => (after ? [...previous, ...data.docs] : data.docs))
        setNext(data.next)
        setCanEdit(data.canEdit)
        setError('')
      })
      .catch((cause) => {
        if (!controller.signal.aborted && version === generation.current) {
          setError(cause.message)
          deny(cause)
        }
      })
    return () => controller.abort()
  }, [api, site, domain, after, archived, refresh, deny])
  useEffect(() => {
    const focus = () => {
      if (!busy) {
        setAfter('')
        setRefresh((value) => value + 1)
      }
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [busy])
  const change = (field: string, value: ImportColumnMapping | null) => {
    setColumns((previous) => [
      ...previous.filter((column) => column.field !== field),
      ...(value ? [value] : []),
    ])
    setRunDirty(true)
    callbacks.current.onDirty(true)
    setNotice('')
    operation.current = null
  }
  const current = () =>
    importMapping({
      version: columns.some((column) => column.translations) ? 2 : 1,
      domain,
      headers,
      columns,
    })
  const matchDefinition = importFields(domain).find((field) => field.id === matchingField)
  const matchColumn = columns.find((column) => column.field === matchingField)
  const matchingValue =
    (matchingTranslation
      ? matchColumn?.translations?.[matchingTranslation.index]?.value
      : matchColumn?.value) || ''
  const chooseReference = (id: string) => {
    const column = columns.find((value) => value.field === matchingField)
    if (matchingTranslation) {
      if (
        !column?.translations ||
        column.translations[matchingTranslation.index]?.source !== matchingTranslation.source
      ) {
        setError('The translation changed. Reopen its record choices.')
      } else
        change(matchingField, {
          ...column,
          translations: column.translations.map((pair, index) =>
            index === matchingTranslation.index ? { ...pair, value: id } : pair,
          ),
        })
    } else
      change(matchingField, {
        field: matchingField,
        value: id,
        clearBlank: false,
        referenceMode: 'record',
      })
    setMatchingField('')
    setMatchingTranslation(null)
  }
  const saving = (value: boolean) => {
    setBusy(value)
    callbacks.current.onSaving(value)
  }
  const load = async () => {
    if (!selectedID || busy) return
    if (
      (runDirty || nameDirty) &&
      !window.confirm('Replace the current unsaved field choices with this saved mapping?')
    )
      return
    saving(true)
    setError('')
    setNotice('')
    try {
      const { doc } = await crmRead<{ doc: SavedImportMapping }>(
        `${api}/crm/import-mappings?${new URLSearchParams({ site, domain, id: selectedID })}`,
      )
      if (!alive.current) return
      if (!importHeadersMatch(doc.mapping, headers))
        throw new Error(
          'This saved mapping uses different source headers. Map the current file explicitly or choose a matching template.',
        )
      setColumns(doc.mapping.columns)
      setSelected(doc)
      setName(doc.name)
      setRunDirty(true)
      setNameDirty(false)
      operation.current = null
      callbacks.current.onDirty(true)
    } catch (cause) {
      if (alive.current) {
        setError((cause as Error).message)
        deny(cause)
      }
    } finally {
      if (alive.current) saving(false)
    }
  }
  const save = async (update: boolean, archive = false) => {
    if (busy) return
    saving(true)
    setError('')
    setNotice('')
    try {
      if (update && !selected) throw new Error('Choose and load a saved mapping first.')
      const body = {
        action: 'save',
        site,
        domain,
        ...(update ? { id: selected!.id, expectedRevision: selected!.revision } : {}),
        name: archive ? selected!.name : name,
        mapping: archive ? selected!.mapping : current(),
        archived: archive,
      }
      const fingerprint = JSON.stringify(body)
      if (operation.current?.fingerprint !== fingerprint)
        operation.current = { fingerprint, key: crypto.randomUUID() }
      const { doc } = await crmRead<{ doc: SavedImportMapping }>(`${api}/crm/import-mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationKey: operation.current.key }),
      })
      if (!alive.current) return
      if (archive) {
        setSelected(null)
        setSelectedID('')
      } else {
        setSelected(doc)
        setSelectedID(doc.id)
        setNameDirty(false)
        callbacks.current.onDirty(runDirty)
      }
      operation.current = null
      setAfter('')
      setRefresh((value) => value + 1)
      setNotice(
        archive
          ? 'Saved mapping archived.'
          : 'Reusable mapping saved. Apply the field choices to this import when ready.',
      )
    } catch (cause) {
      if (alive.current) {
        setError((cause as Error).message)
        deny(cause)
      }
    } finally {
      if (alive.current) saving(false)
    }
  }
  const apply = async () => {
    if (busy) return
    saving(true)
    setError('')
    setNotice('')
    try {
      await onConfigured(current())
      if (alive.current) {
        setRunDirty(false)
        callbacks.current.onDirty(nameDirty)
        setNotice('Field mapping applied to this import. Review the rows before approval.')
      }
    } catch (cause) {
      if (alive.current) {
        setError((cause as Error).message)
        deny(cause)
      }
    } finally {
      if (alive.current) saving(false)
    }
  }
  return (
    <section className="vc-crm-domain" aria-label="Import field mapping">
      <h3>Map source fields</h3>
      <p>
        Unmapped fields and blank cells preserve existing values. Select clear only when an empty
        source cell should remove an existing value. Saving a template does not approve or apply
        donor records.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={busy}>
        <legend>Reusable mappings</legend>
        <label>
          Show archived mappings
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked)
              setAfter('')
              setSaved([])
              setSelectedID('')
            }}
          />
        </label>
        <label>
          Saved mapping
          <select value={selectedID} onChange={(e) => setSelectedID(e.target.value)}>
            <option value="">Choose a mapping</option>
            {saved.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!selectedID || !canEdit} onClick={() => void load()}>
          Load saved mapping
        </button>
        {next && (
          <button type="button" onClick={() => setAfter(next)}>
            Load more mappings
          </button>
        )}
      </fieldset>
      <fieldset disabled={busy || !canEdit}>
        <legend>Current file</legend>
        <div className="vc-crm-table-wrap">
          <table>
            <thead>
              <tr>
                <th>CRM field</th>
                <th>Source</th>
                <th>Value/reference</th>
                <th>Blank cells</th>
              </tr>
            </thead>
            <tbody>
              {importFields(domain).map((field) => {
                const column = columns.find((value) => value.field === field.id)
                const mode = !column
                  ? 'skip'
                  : column.column === undefined
                    ? 'fixed'
                    : String(column.column)
                const update = (patch: Partial<ImportColumnMapping>) =>
                  change(field.id, {
                    field: field.id,
                    clearBlank: false,
                    referenceMode: 'record',
                    ...column,
                    ...patch,
                  })
                return (
                  <tr key={field.id}>
                    <th scope="row">{field.label}</th>
                    <td>
                      <select
                        aria-label={`${field.label} source`}
                        value={mode}
                        onChange={(e) => {
                          if (e.target.value === 'skip') change(field.id, null)
                          else
                            change(field.id, {
                              field: field.id,
                              ...(e.target.value === 'fixed'
                                ? { value: '' }
                                : { column: Number(e.target.value) }),
                              clearBlank: column?.clearBlank || false,
                              referenceMode: column?.referenceMode || 'record',
                            })
                        }}
                      >
                        <option value="skip">Not mapped</option>
                        <option value="fixed">Fixed value</option>
                        {headers.map((header, index) => (
                          <option key={index} value={index}>
                            {index + 1}: {header.slice(0, 120) || '(blank header)'}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {column?.column === undefined && column && (
                        <input
                          aria-label={`${field.label} fixed value`}
                          value={column.value || ''}
                          maxLength={32768}
                          onChange={(e) => update({ value: e.target.value })}
                        />
                      )}
                      {runID && column && column.column === undefined && field.reference && (
                        <button
                          type="button"
                          onClick={() => {
                            setMatchingTranslation(null)
                            setMatchingField(field.id)
                          }}
                        >
                          Choose {field.label.toLowerCase()} record
                        </button>
                      )}
                      {column &&
                        column.column !== undefined &&
                        !['sourceID', 'recordID'].includes(field.id) && (
                          <ImportValueTranslations
                            column={column}
                            label={field.label}
                            source={runID ? { api, site, run: runID, onDenied } : undefined}
                            onChange={(next) => change(field.id, next)}
                            onChoose={
                              runID && field.reference
                                ? (index) => {
                                    setMatchingTranslation({
                                      index,
                                      source: column.translations![index].source,
                                    })
                                    setMatchingField(field.id)
                                  }
                                : undefined
                            }
                          />
                        )}
                      {column && field.kind === 'reference' && (
                        <select
                          aria-label={`${field.label} reference type`}
                          value={column.referenceMode}
                          onChange={(e) =>
                            update({ referenceMode: e.target.value as 'record' | 'source' })
                          }
                        >
                          <option value="record">CRM record ID</option>
                          <option value="source">Source-system record ID</option>
                        </select>
                      )}
                    </td>
                    <td>
                      {column && (
                        <label>
                          <input
                            type="checkbox"
                            checked={column.clearBlank}
                            disabled={['sourceID', 'recordID'].includes(field.id)}
                            onChange={(e) => update({ clearBlank: e.target.checked })}
                          />
                          Clear when blank
                        </label>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button type="button" disabled={!columns.length} onClick={() => void apply()}>
          Apply mapping to this import
        </button>
        <label>
          Mapping name
          <input
            maxLength={180}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameDirty(true)
              callbacks.current.onDirty(true)
              operation.current = null
            }}
          />
        </label>
        <button
          type="button"
          disabled={!canEdit || !name.trim() || !columns.length}
          onClick={() => void save(false)}
        >
          Save new reusable mapping
        </button>
        {selected && (
          <>
            <button
              type="button"
              disabled={!canEdit || !name.trim() || !columns.length}
              onClick={() => void save(true)}
            >
              {selected.archived ? 'Restore and update loaded mapping' : 'Update loaded mapping'}
            </button>
            <button
              type="button"
              disabled={!canEdit || !!selected.archived}
              onClick={() => void save(true, true)}
            >
              Archive loaded mapping
            </button>
          </>
        )}
      </fieldset>
      {runID && matchDefinition && (
        <section aria-label="Choose mapped reference">
          {matchDefinition.reference === 'contacts' ? (
            <ImportContactMatch
              api={api}
              site={site}
              value={matchingValue}
              disabled={busy || !canEdit}
              onChange={chooseReference}
              onDenied={onDenied}
            />
          ) : (
            <ImportReferenceMatch
              api={api}
              site={site}
              run={runID}
              field={matchingField}
              label={matchDefinition.label}
              value={matchingValue}
              disabled={busy || !canEdit}
              onChange={chooseReference}
              onDenied={onDenied}
            />
          )}
          <button
            type="button"
            onClick={() => {
              setMatchingField('')
              setMatchingTranslation(null)
            }}
          >
            Close reference choices
          </button>
        </section>
      )}
    </section>
  )
}
