'use client'
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import { importFields, mapImportRow, type MappedImportCell } from './import-model'
import type { ImportDecision, ImportReview } from './import-domain-plan'
import type { ImportRuns } from './import-runs'
import { ImportContactMatch } from './ImportContactMatch'
import { ImportReferenceMatch } from './ImportReferenceMatch'
import { ImportChangePreview } from './ImportChangePreview'

type Run = Awaited<ReturnType<ImportRuns['get']>>
type Source = Awaited<ReturnType<ImportRuns['row']>>
type Props = {
  api: string
  site: string
  run: Run
  number: number
  reviewSaved?: boolean
  applied?: boolean
  onSaved: () => Promise<void>
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
  onDenied: () => void
}
export function ImportRowReview(props: Props) {
  return (
    <RowReview
      key={`${props.site}:${props.run.doc.id}:${props.run.doc.config_revision}:${props.number}`}
      {...props}
    />
  )
}
function RowReview({
  api,
  site,
  run,
  number,
  reviewSaved = false,
  applied = false,
  onSaved,
  onDirty,
  onSaving,
  onDenied,
}: Props) {
  const [source, setSource] = useState<Source | null>(null),
    [loadSaved] = useState(reviewSaved),
    [review, setReview] = useState<ImportReview | null>(null),
    [decision, setDecision] = useState<ImportDecision | ''>(''),
    [target, setTarget] = useState(''),
    [matchingField, setMatchingField] = useState(''),
    [overrides, setOverrides] = useState<Record<string, MappedImportCell>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true),
    active = useRef(false),
    retry = useRef<{ body: string; key: string } | null>(null)
  useEffect(() => {
    alive.current = true
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        site,
        id: run.doc.id,
        view: 'row',
        number: String(number),
      })
      void crmRead<{ doc: Source }>(`${api}/crm/imports?${query}`)
        .then(async (result) => {
          let saved: ImportReview | null = null
          if (result.doc.reviewSaved || loadSaved) {
            query.set('view', 'review')
            saved = (await crmRead<{ doc: ImportReview }>(`${api}/crm/imports?${query}`)).doc
          }
          if (!alive.current) return
          setSource(result.doc)
          if (saved) {
            setReview(saved)
            setDecision(saved.selection.decision)
            setTarget(saved.selection.target || '')
            setOverrides(saved.values)
          }
        })
        .catch((cause: unknown) => {
          if (!alive.current) return
          if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) onDenied()
          else setError(cause instanceof Error ? cause.message : 'Unable to load source row.')
        })
    }, 0)
    return () => {
      alive.current = false
      window.clearTimeout(timer)
    }
  }, [api, site, run.doc.id, number, loadSaved, onDenied])
  const changed = () => {
    setReview(null)
    setError('')
    onDirty(true)
  }
  const save = async () => {
    if (
      active.current ||
      !source ||
      !decision ||
      !run.canEdit ||
      applied ||
      run.doc.status !== 'draft'
    )
      return
    active.current = true
    setBusy(true)
    setError('')
    onSaving(true)
    const body = JSON.stringify({
      action: 'review',
      site,
      id: run.doc.id,
      expectedRevision: run.doc.revision,
      number,
      rowRevision: source.revision,
      decision,
      target: target.trim() || null,
      overrides,
    })
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() }
    try {
      const result = await crmRead<{ doc: { revision: number } }>(`${api}/crm/imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(body), operationKey: retry.current.key }),
      })
      if (!alive.current) return
      setSource({ ...source, revision: result.doc.revision })
      const query = new URLSearchParams({
        site,
        id: run.doc.id,
        view: 'review',
        number: String(number),
      })
      const snapshot = await crmRead<{ doc: ImportReview }>(`${api}/crm/imports?${query}`)
      if (!alive.current) return
      setReview(snapshot.doc)
      onDirty(false)
      await onSaved()
    } catch (cause) {
      if (!alive.current) return
      if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) {
        setSource(null)
        setReview(null)
        setOverrides({})
        setTarget('')
        onDirty(false)
        onDenied()
      } else setError(cause instanceof Error ? cause.message : 'Unable to save row review.')
    } finally {
      active.current = false
      if (alive.current) {
        setBusy(false)
        onSaving(false)
      }
    }
  }
  if (!source) return error ? <p role="alert">{error}</p> : <p role="status">Loading source row…</p>
  const mapped = run.mapping ? mapImportRow(source, run.mapping) : null
  const matchDefinition = importFields(run.doc.domain).find((field) => field.id === matchingField)
  const chooseReference = (id: string) => {
    changed()
    setOverrides((current) => ({
      ...current,
      [matchingField]: { value: id, clear: false, referenceMode: 'record' },
    }))
    setMatchingField('')
  }
  return (
    <section aria-label={`Review source row ${number}`}>
      <h3>Source row {number}</h3>
      <p>
        Saving a decision prepares a review. Applying changes requires the separate import approval.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <caption>Original source values</caption>
          <thead>
            <tr>
              <th>Column</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {source.values.map((value, index) => (
              <tr key={index}>
                <th>
                  {index + 1}. {run.headers[index] || '(no header)'}
                </th>
                <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(decision === 'update' || decision === 'keep') && run.doc.domain === 'contacts' && (
        <ImportContactMatch
          api={api}
          site={site}
          value={target}
          disabled={busy || !run.canEdit || applied || run.doc.status !== 'draft'}
          onChange={(id) => {
            changed()
            setTarget(id)
          }}
          onDenied={onDenied}
        />
      )}
      <fieldset disabled={busy || !run.canEdit || applied || run.doc.status !== 'draft'}>
        <label>
          Decision
          <select
            value={decision}
            onChange={(event) => {
              changed()
              setDecision(event.target.value as ImportDecision | '')
            }}
          >
            <option value="">Choose a decision</option>
            <option value="create">Create a new record</option>
            <option value="update">Update an existing record</option>
            <option value="keep">Keep the existing record</option>
            <option value="skip">Skip this source row</option>
          </select>
        </label>
        {(decision === 'update' || decision === 'keep') && (
          <label>
            Existing CRM record identifier (optional when mapped)
            <input
              value={target}
              onChange={(event) => {
                changed()
                setTarget(event.target.value)
              }}
            />
          </label>
        )}
        <p>
          Mapped source identifiers match within this source dataset and chapter. Donation amount
          and date never establish a match.
        </p>
        <details>
          <summary>Correct mapped fields for this row</summary>
          {importFields(run.doc.domain).map((field) => {
            const cell = overrides[field.id] ||
              mapped?.values[field.id] || {
                value: '',
                clear: false,
                referenceMode: 'record' as const,
              }
            const update = (next: MappedImportCell) => {
              changed()
              setOverrides((current) => ({ ...current, [field.id]: next }))
            }
            return (
              <div key={field.id}>
                <label>
                  {field.label}
                  <input
                    value={cell.value}
                    onChange={(event) => update({ ...cell, value: event.target.value })}
                  />
                </label>
                {!['sourceID', 'recordID'].includes(field.id) && (
                  <label>
                    <input
                      type="checkbox"
                      checked={cell.clear}
                      onChange={(event) => update({ ...cell, clear: event.target.checked })}
                    />
                    Explicitly clear when blank
                  </label>
                )}
                {field.reference && (
                  <label>
                    {field.label} identifier type
                    <select
                      value={cell.referenceMode}
                      onChange={(event) =>
                        update({
                          ...cell,
                          referenceMode: event.target.value as 'record' | 'source',
                        })
                      }
                    >
                      <option value="record">CRM record identifier</option>
                      <option value="source">Source dataset identifier</option>
                    </select>
                  </label>
                )}
                {field.reference && (
                  <button type="button" onClick={() => setMatchingField(field.id)}>
                    {field.reference === 'contacts' ? 'Find constituent for' : 'Find record for'}{' '}
                    {field.label}
                  </button>
                )}
                {overrides[field.id] && (
                  <button
                    type="button"
                    onClick={() => {
                      changed()
                      setOverrides((current) => {
                        const next = { ...current }
                        delete next[field.id]
                        return next
                      })
                    }}
                  >
                    Use mapping for {field.label}
                  </button>
                )}
              </div>
            )
          })}
        </details>
        <button type="button" disabled={!decision} onClick={() => void save()}>
          Save decision and preview changes
        </button>
      </fieldset>
      {matchingField && matchDefinition && (
        <section aria-label="Match linked import field">
          <h4>
            Choose {importFields(run.doc.domain).find((field) => field.id === matchingField)?.label}
          </h4>
          {matchDefinition.reference === 'contacts' ? (
            <ImportContactMatch
              api={api}
              site={site}
              value={overrides[matchingField]?.value || mapped?.values[matchingField]?.value || ''}
              disabled={busy || !run.canEdit || applied || run.doc.status !== 'draft'}
              onDenied={onDenied}
              onChange={chooseReference}
            />
          ) : (
            <ImportReferenceMatch
              api={api}
              site={site}
              run={run.doc.id}
              field={matchingField}
              label={matchDefinition.label}
              value={overrides[matchingField]?.value || mapped?.values[matchingField]?.value || ''}
              disabled={busy || !run.canEdit || applied || run.doc.status !== 'draft'}
              onDenied={onDenied}
              onChange={chooseReference}
            />
          )}
          <button type="button" onClick={() => setMatchingField('')}>
            Close reference search
          </button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {review && (
        <section aria-label="Saved proposed changes">
          <h4>Saved decision: {review.selection.decision}</h4>
          <p>
            {review.selection.decision === 'skip'
              ? 'Skip this source row. No CRM record will be created or changed.'
              : review.selection.decision === 'keep'
                ? 'Keep the existing record values. Approval may associate its source identifier for future imports.'
                : review.selection.decision === 'create'
                  ? 'Create a new record only after this import is explicitly approved.'
                  : 'Apply the reviewed update only after this import is explicitly approved.'}
          </p>
          {review.issues.length ? (
            review.issues.map((issue, index) => (
              <p role="alert" key={index}>
                {issue.field ? `${issue.field}: ` : ''}
                {issue.message}
              </p>
            ))
          ) : (
            <p>
              Review validation passed. This record has not been applied by saving this decision.
            </p>
          )}
          <ImportChangePreview before={review.before} after={review.after} />
        </section>
      )}
    </section>
  )
}
