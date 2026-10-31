'use client'
import { RecordTaskLink } from './RecordTaskLink'
import { useCallback, useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import { ImportSourcePreview } from './ImportSourcePreview'
import { ImportMappingEditor } from './ImportMappingEditor'
import { ImportRowsWorkspace } from './ImportRowsWorkspace'
import { ImportUploadResume } from './ImportUploadResume'
import type { ImportRuns } from './import-runs'
import type { ImportBulkPolicy } from './import-bulk-review'
import { useImportEditorActivity } from './useImportEditorActivity'
import { ImportResultFiles } from './ImportResultFiles'

type Run = Awaited<ReturnType<ImportRuns['get']>>
type Props = {
  api: string
  site: string
  id: string
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
  onDenied: () => void
}
export function ImportRunWorkspace(props: Props) {
  return <RunWorkspace key={`${props.site}:${props.id}`} {...props} />
}
function RunWorkspace({ api, site, id, onDirty, onSaving, onDenied }: Props) {
  const [run, setRun] = useState<Run | null>(null),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [editorVersion, setEditorVersion] = useState(0),
    [wakePending, setWakePending] = useState(false),
    [allowUnidentified, setAllowUnidentified] = useState(false)
  const [bulkPolicy, setBulkPolicy] = useState<ImportBulkPolicy>('create-or-keep')
  const { scopes, flags, reset, hasActivity, busy, dirty } = useImportEditorActivity(
    onDirty,
    onSaving,
  )
  const loaded = useRef<Run | null>(null)
  const alive = useRef(true),
    fetching = useRef(0),
    active = useRef(false),
    pending = useRef<{ body: string; key: string } | null>(null)
  const denied = useCallback(
    (cause: unknown) => {
      if (!alive.current) return
      if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) {
        setRun(null)
        loaded.current = null
        pending.current = null
        reset()
        onDenied()
      } else setError(cause instanceof Error ? cause.message : 'Unable to load this import.')
    },
    [onDenied, reset],
  )
  const refresh = useCallback(
    async (acceptChanges = false, discardEdits = false) => {
      const generation = ++fetching.current
      const query = new URLSearchParams({ site, id })
      try {
        const result = await crmRead<Run>(`${api}/crm/imports?${query}`)
        if (alive.current && generation === fetching.current) {
          const previous = loaded.current
          if (
            !acceptChanges &&
            previous &&
            result.canEdit &&
            hasActivity() &&
            (result.doc.revision !== previous.doc.revision ||
              result.doc.config_revision !== previous.doc.config_revision ||
              result.doc.status !== previous.doc.status ||
              result.doc.stage_state !== previous.doc.stage_state)
          ) {
            setConflict(true)
            setError(
              'This import changed while you were editing. Your draft is retained. Reload the saved import to discard your draft and review the latest changes.',
            )
            return
          }
          if (discardEdits || (previous?.canEdit && !result.canEdit)) {
            reset()
            setEditorVersion((version) => version + 1)
          }
          loaded.current = result
          setRun(result)
          setConflict(false)
          setError('')
        }
      } catch (cause) {
        if (generation === fetching.current) denied(cause)
      }
    },
    [api, site, id, denied, hasActivity, reset],
  )
  useEffect(() => {
    alive.current = true
    ++fetching.current
    const initial = window.setTimeout((): void => {
      void refresh()
    }, 0)
    const focus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', focus)
    return () => {
      alive.current = false
      window.clearTimeout(initial)
      window.removeEventListener('focus', focus)
    }
  }, [refresh])
  const running = run?.job && ['pending', 'running'].includes(run.job.status)
  useEffect(() => {
    if (!running || busy || dirty) return
    const timer = window.setInterval((): void => {
      void refresh()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [running, busy, dirty, refresh])
  const mutate = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!run || !run.canEdit || active.current) return
    active.current = true
    scopes.run.onSaving(true)
    setError('')
    const body = JSON.stringify({ action, site, id, expectedRevision: run.doc.revision, ...extra })
    if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() }
    try {
      const response = await crmRead<{ backgroundWakePending?: boolean }>(`${api}/crm/imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(body), operationKey: pending.current.key }),
      })
      if (!alive.current) return
      pending.current = null
      setWakePending(!!response.backgroundWakePending)
      await refresh(true)
    } catch (cause) {
      denied(cause)
      throw cause
    } finally {
      active.current = false
      if (alive.current) {
        scopes.run.onSaving(false)
      }
    }
  }
  const act = (action: string, extra?: Record<string, unknown>): void =>
    void mutate(action, extra).catch(() => {})
  if (!run)
    return (
      <section aria-label="Import run">
        {error ? <p role="alert">{error}</p> : <p role="status">Loading import…</p>}
      </section>
    )
  const { doc, job, totals } = run
  return (
    <section aria-label="Import run">
      <h2>{doc.name}</h2>
      <RecordTaskLink site={site} link={{ type: 'import-run', id: doc.id }} label="Follow-up tasks" />
      <p>
        {doc.file_name} · {doc.source_system}
      </p>
      <p>
        Source: {doc.stage_state}. Approval: {doc.status}.
      </p>
      {error && <p role="alert">{error}</p>}
      {conflict && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                'Discard this unsaved import draft and reload the latest saved import?',
              )
            )
              void refresh(true, true)
          }}
        >
          Discard draft and reload saved import
        </button>
      )}
      {wakePending && (
        <p role="status">
          Your request is saved. Background dispatch has not acknowledged it yet; refresh or retry
          processing.
        </p>
      )}
      <button type="button" disabled={busy || dirty} onClick={() => void refresh()}>
        Refresh import
      </button>
      <a href={`${api}/crm/imports?${new URLSearchParams({ site, id, view: 'source' })}`}>
        Download original source
      </a>
      {doc.stage_state === 'review' && !running && (
        <p>
          Spreadsheet review downloads protect formula-leading values and long numbers as text. Use
          the original source download for unchanged file bytes.
        </p>
      )}
      {doc.stage_state === 'review' && (
        <ImportResultFiles
          api={api}
          site={site}
          id={id}
          revision={doc.revision}
          disabled={busy || dirty || !!running}
          onSaving={scopes.results.onSaving}
          onDenied={onDenied}
        />
      )}
      {totals && (
        <p>
          {totals.rows} source rows · {totals.reviewed} current reviews · {totals.applied} applied ·{' '}
          {totals.created} created · {totals.updated} updated · {totals.kept} kept ·{' '}
          {totals.skipped} skipped
        </p>
      )}
      {job && (
        <section aria-label="Import processing">
          <h3>Processing: {job.status}</h3>
          <p>
            {job.progress} completed processing units · attempt {job.attempts}
          </p>
          {job.error && <p role="alert">{job.error}</p>}
          {run.canEdit && (
            <>
              {running && (
                <button
                  type="button"
                  disabled={busy || dirty}
                  onClick={() => act('cancel', { expectedFence: job.fence })}
                >
                  Cancel processing
                </button>
              )}
              {['failed', 'cancelled'].includes(job.status) && (
                <button
                  type="button"
                  disabled={busy || dirty}
                  onClick={() => act('retry', { expectedFence: job.fence })}
                >
                  Retry processing
                </button>
              )}
              {running && (
                <button type="button" disabled={busy || dirty} onClick={() => act('wake')}>
                  Resume background processing
                </button>
              )}
            </>
          )}
        </section>
      )}
      {doc.stage_state === 'uploading' && (
        <ImportUploadResume
          key={editorVersion}
          api={api}
          site={site}
          run={run}
          onUploaded={async () => {
            await refresh(true)
          }}
          onDirty={scopes.upload.onDirty}
          onSaving={scopes.upload.onSaving}
          onDenied={onDenied}
        />
      )}
      {doc.stage_state === 'ready' && (
        <>
          <ImportSourcePreview
            key={editorVersion}
            api={api}
            site={site}
            id={id}
            revision={doc.revision}
            kind={doc.file_kind}
            initialOptions={{
              headerRow: doc.header_row,
              sheet: doc.sheet_name,
              delimiter: doc.delimiter,
            }}
            canEdit={run.canEdit}
            onConfigured={async () => {
              await refresh(true)
            }}
            onDirty={scopes.source.onDirty}
            onSaving={scopes.source.onSaving}
            onDenied={onDenied}
          />
          {!!run.headers.length && (
            <button
              type="button"
              disabled={busy || dirty || !run.canEdit}
              onClick={() => act('stage')}
            >
              Prepare source rows for mapping
            </button>
          )}
        </>
      )}
      {doc.stage_state === 'review' && doc.status === 'draft' && (
        <>
          {run.mapping && run.canEdit && (
            <fieldset disabled={busy || dirty || !!running}>
              <legend>Prepare decisions in bulk</legend>
              <p>
                Prepare rows that have no saved decision. Existing staff decisions are preserved.
                Matches use explicit CRM or source dataset identifiers; names, amounts and dates
                never establish a match. Review the proposals before approving application.
              </p>
              <label>
                Bulk review policy
                <select
                  value={bulkPolicy}
                  onChange={(event) => setBulkPolicy(event.target.value as ImportBulkPolicy)}
                >
                  <option value="create-or-keep">
                    Create new records; keep identified existing records
                  </option>
                  <option value="create-or-update">
                    Create new records; update identified existing records
                  </option>
                  <option value="skip">Skip undecided rows</option>
                </select>
              </label>
              <button type="button" onClick={() => act('bulk-review', { policy: bulkPolicy })}>
                Prepare undecided row reviews
              </button>
            </fieldset>
          )}
          <fieldset
            disabled={
              flags.run.saving || flags.rows.dirty || flags.rows.saving || !!running || !run.canEdit
            }
          >
            <legend>Field mapping</legend>
            <ImportMappingEditor
              key={`${doc.config_revision}:${editorVersion}`}
              api={api}
              site={site}
              domain={doc.domain}
              runID={id}
              headers={run.headers}
              mapping={run.mapping}
              onConfigured={async (mapping) => {
                await mutate('mapping', { mapping })
                scopes.mapping.onDirty(false)
              }}
              onDirty={scopes.mapping.onDirty}
              onSaving={scopes.mapping.onSaving}
              onDenied={onDenied}
            />
          </fieldset>
          {run.mapping && run.canEdit && (
            <fieldset disabled={busy || dirty || !!running}>
              <legend>Approve reviewed changes</legend>
              <p>
                Approval applies the reviewed records. Every pending row must have a valid current
                decision. Changes to records or permissions can require a new review.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={allowUnidentified}
                  onChange={(event) => setAllowUnidentified(event.target.checked)}
                />
                Allow explicitly reviewed new records without source identifiers
              </label>
              <button
                type="button"
                disabled={!totals?.pending || totals.pendingReviewed !== totals.pending}
                onClick={() => {
                  if (window.confirm('Apply the reviewed import changes to this chapter?'))
                    act('approve', { allowNewUnidentified: allowUnidentified })
                }}
              >
                Approve and apply reviewed records
              </button>
            </fieldset>
          )}
        </>
      )}
      {doc.stage_state === 'review' && run.mapping && (
        <fieldset disabled={flags.run.saving || flags.mapping.dirty || flags.mapping.saving}>
          <legend>Source rows and decisions</legend>
          <ImportRowsWorkspace
            key={editorVersion}
            api={api}
            site={site}
            run={run}
            refresh={async () => {
              await refresh(true)
            }}
            onDirty={scopes.rows.onDirty}
            onSaving={scopes.rows.onSaving}
            onDenied={onDenied}
          />
        </fieldset>
      )}
      {doc.status === 'approved' && !running && run.canEdit && (
        <button type="button" disabled={busy || dirty} onClick={() => act('reopen')}>
          Reopen remaining records for review
        </button>
      )}
    </section>
  )
}
