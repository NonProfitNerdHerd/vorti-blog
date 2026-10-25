'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { listImportExports } from './import-export-controls'
type Page = Awaited<ReturnType<typeof listImportExports>>
type Props = {
  api: string
  site: string
  id: string
  revision: number
  disabled: boolean
  onSaving: (value: boolean) => void
  onDenied: () => void
}
export function ImportResultFiles({
  api,
  site,
  id,
  revision,
  disabled,
  onSaving,
  onDenied,
}: Props) {
  const [page, setPage] = useState<Page | null>(null),
    [after, setAfter] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const alive = useRef(true),
    sequence = useRef(0),
    pending = useRef<{ body: string; key: string } | null>(null)
  const deny = useCallback(
    (cause: unknown) => {
      if (!alive.current) return
      if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) {
        setPage(null)
        onDenied()
      } else setError(cause instanceof Error ? cause.message : 'Unable to prepare import results.')
    },
    [onDenied],
  )
  const load = useCallback(async () => {
    const version = ++sequence.current
    try {
      const data = await crmRead<Page>(
        `${api}/crm/imports?${new URLSearchParams({ site, id, view: 'result-files', after })}`,
      )
      if (!Array.isArray(data.docs)) throw Error('Unable to load result files.')
      if (alive.current && version === sequence.current) {
        setPage(data)
        setError('')
      }
    } catch (cause) {
      if (version === sequence.current) deny(cause)
    }
  }, [api, site, id, after, deny])
  useEffect(() => {
    alive.current = true
    const timer = window.setTimeout(() => {
        void load()
      }, 0),
      focus = () => {
        void load()
      }
    window.addEventListener('focus', focus)
    return () => {
      alive.current = false
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate pending requests; this is a monotonic counter, not a DOM ref.
      ++sequence.current
      window.clearTimeout(timer)
      window.removeEventListener('focus', focus)
    }
  }, [load, revision])
  const running = page?.docs.some((file) => ['pending', 'running'].includes(file.status))
  useEffect(() => {
    if (!running || busy) return
    const timer = window.setInterval(() => {
      void load()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [running, busy, load])
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (busy || disabled) return
    setBusy(true)
    onSaving(true)
    setError('')
    setNotice('')
    const body = JSON.stringify({ action, site, id, expectedRevision: revision, ...extra })
    if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() }
    try {
      const result = await crmRead<{ backgroundWakePending?: boolean }>(`${api}/crm/imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(body), operationKey: pending.current.key }),
      })
      if (!alive.current) return
      pending.current = null
      setNotice(
        result.backgroundWakePending
          ? 'Request saved. Background dispatch has not acknowledged it yet; retry processing if needed.'
          : 'Result file request saved.',
      )
      await load()
    } catch (cause) {
      deny(cause)
    } finally {
      if (alive.current) {
        setBusy(false)
        onSaving(false)
      }
    }
  }
  return (
    <section aria-label="Private import result files">
      <h3>Private result downloads</h3>
      <p>
        Prepare a complete file in the background. Files remain private, expire after seven days,
        and require current access at download.
      </p>
      <fieldset disabled={disabled || busy}>
        <legend>Prepare a download</legend>
        <button type="button" onClick={() => void act('prepare-results', { errorsOnly: false })}>
          Prepare full results CSV
        </button>
        <button type="button" onClick={() => void act('prepare-results', { errorsOnly: true })}>
          Prepare error rows CSV
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button type="button" disabled={busy} onClick={() => void load()}>
        Refresh result files
      </button>
      {page ? (
        <>
          <div className="vc-crm-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {page.docs.map((file) => (
                  <tr key={file.id}>
                    <th scope="row">
                      {file.errorsOnly ? 'Error rows' : 'Full results'} · {file.createdAt}
                    </th>
                    <td>
                      {file.expired
                        ? 'Expired'
                        : file.stale
                          ? 'Import or permissions changed; prepare a new file'
                          : file.status}
                      {file.error && <p>{file.error}</p>}
                    </td>
                    <td>
                      {file.progress} / {file.rows} rows generated
                      {file.status === 'pending' && file.progress === file.rows
                        ? '; assembling private file'
                        : ''}
                      {file.bytes !== null ? ` · ${file.bytes} bytes` : ''}
                    </td>
                    <td>{file.expiresAt}</td>
                    <td>
                      {file.downloadable && (
                        <a
                          href={`${api}/crm/imports?${new URLSearchParams({ site, id, view: 'result-file', export: file.id })}`}
                        >
                          Download {file.errorsOnly ? 'error rows' : 'full results'} CSV
                        </a>
                      )}
                      {['pending', 'running'].includes(file.status) && (
                        <>
                          <button
                            type="button"
                            disabled={busy || disabled}
                            onClick={() =>
                              void act('cancel-results', {
                                export: file.id,
                                expectedFence: file.fence,
                              })
                            }
                          >
                            Cancel result file
                          </button>
                          {!file.expired && !file.stale && (
                            <button
                              type="button"
                              disabled={busy || disabled}
                              onClick={() =>
                                void act('wake-results', {
                                  export: file.id,
                                  expectedFence: file.fence,
                                })
                              }
                            >
                              Retry result processing
                            </button>
                          )}
                        </>
                      )}
                      {['cancelled', 'failed'].includes(file.status) &&
                        !file.expired &&
                        !file.stale && (
                          <button
                            type="button"
                            disabled={busy || disabled}
                            onClick={() =>
                              void act('retry-results', {
                                export: file.id,
                                expectedFence: file.fence,
                              })
                            }
                          >
                            Resume result file
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!page.docs.length && <p>No result files prepared yet.</p>}
          <button type="button" disabled={!after || busy} onClick={() => setAfter('')}>
            First result files
          </button>
          <button type="button" disabled={!page.next || busy} onClick={() => setAfter(page.next!)}>
            More result files
          </button>
        </>
      ) : (
        <p role="status">Loading result files…</p>
      )}
    </section>
  )
}
