'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Each authorized request synchronizes its loading/error state, following the existing Dashboard widget pattern. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContactCorrection } from './contacts'

type Cursor = { id: string; createdAt: string }
type Result = { docs: ContactCorrection[]; total: number; next: Cursor | null; canResolve: boolean }
export function ContactCorrections({
  api,
  site,
  contact,
  onDirty,
  onSaving,
  onAccessLost,
}: {
  api: string
  site: string
  contact: string
  onDirty: (dirty: boolean) => void
  onSaving: (saving: boolean) => void
  onAccessLost: () => void
}) {
  const [result, setResult] = useState<Result | null>(null),
    [cursor, setCursor] = useState<Cursor | null>(null),
    [pages, setPages] = useState<Array<Cursor | null>>([])
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<ContactCorrection | null>(null),
    [reason, setReason] = useState(''),
    [status, setStatus] = useState<'resolved' | 'declined'>('resolved'),
    [saving, setSaving] = useState(false)
  const operation = useRef<string | null>(null)
  const request = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { ...init, cache: 'no-store' }),
      body = (await response.json()) as T & { message?: string }
    if (!response.ok)
      throw Object.assign(new Error(body.message || 'Unable to load correction requests.'), {
        status: response.status,
      })
    return body
  }, [])
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    const query = new URLSearchParams({ site, id: contact, view: 'corrections' })
    if (cursor) {
      query.set('beforeID', cursor.id)
      query.set('beforeDate', cursor.createdAt)
    }
    void request<Result>(api + '/crm/contacts?' + query)
      .then(
        (data) => {
          if (current) setResult(data)
        },
        (cause) => {
          if (current) {
            if (
              cause &&
              typeof cause === 'object' &&
              'status' in cause &&
              [401, 403].includes(Number(cause.status))
            ) {
              onAccessLost()
              return
            }
            setResult(null)
            setError(cause instanceof Error ? cause.message : 'Unable to load requests.')
          }
        },
      )
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [api, contact, cursor, refresh, request, site, onAccessLost])
  const review = async () => {
    if (!selected || saving) return
    setSaving(true)
    onSaving(true)
    setError('')
    operation.current ||= crypto.randomUUID()
    try {
      await request(api + '/crm/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve-correction',
          site,
          id: contact,
          correction: selected.id,
          expectedRevision: selected.revision,
          status,
          reason,
          operationKey: operation.current,
        }),
      })
      setSelected(null)
      setReason('')
      onDirty(false)
      operation.current = null
      setNotice('Correction request was ' + status + '.')
      setRefresh((value) => value + 1)
    } catch (cause) {
      if (
        cause &&
        typeof cause === 'object' &&
        'status' in cause &&
        [401, 403].includes(Number(cause.status))
      ) {
        onAccessLost()
        return
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to save review. Your input has been retained.',
      )
    } finally {
      setSaving(false)
      onSaving(false)
    }
  }
  return (
    <section aria-labelledby="vc-corrections-heading">
      <h3 id="vc-corrections-heading">Profile correction requests</h3>
      <p>
        Apply agreed changes in Shared profile, then resolve the request. Original requests and
        review history are retained.
      </p>
      <div className="vc-crm-pagination">
        <span>
          {result?.total || 0} requests · Page {pages.length + 1}
        </span>
        <button
          type="button"
          disabled={loading || saving || !!selected || !pages.length}
          onClick={() => {
            setCursor(pages.at(-1) || null)
            setPages((value) => value.slice(0, -1))
          }}
        >
          Previous requests
        </button>
        <button
          type="button"
          disabled={loading || saving || !!selected || !result?.next}
          onClick={() => {
            setPages((value) => [...value, cursor])
            setCursor(result?.next || null)
          }}
        >
          Next requests
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" disabled={saving} onClick={() => setRefresh((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      <div className="vc-crm-table">
        <table aria-busy={loading}>
          <thead>
            <tr>
              <th>Requested by</th>
              <th>Request</th>
              <th>Status</th>
              <th>Created</th>
              {result?.canResolve && <th>Review</th>}
            </tr>
          </thead>
          <tbody>
            {result?.docs.map((row) => (
              <tr key={row.id}>
                <td>{row.actorLabel}</td>
                <td style={{ whiteSpace: 'pre-wrap' }}>{row.message}</td>
                <td>{row.status}</td>
                <td>
                  <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
                </td>
                {result.canResolve && (
                  <td>
                    {row.status === 'open' && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          if (
                            selected &&
                            reason &&
                            !window.confirm('Discard the current review draft?')
                          )
                            return
                          setSelected(row)
                          setReason('')
                          setStatus('resolved')
                          operation.current = null
                          onDirty(false)
                        }}
                      >
                        Review request
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!result?.docs.length && (
              <tr>
                <td colSpan={5}>{loading ? 'Loading requests…' : 'No correction requests.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {selected && (
        <fieldset disabled={saving}>
          <legend>Review correction request</legend>
          <p>{selected.message}</p>
          <label>
            Outcome
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as 'resolved' | 'declined')
                onDirty(true)
                operation.current = null
              }}
            >
              <option value="resolved">Resolved</option>
              <option value="declined">Declined</option>
            </select>
          </label>
          <label>
            Review reason
            <textarea
              required
              maxLength={2000}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                onDirty(true)
                operation.current = null
              }}
            />
          </label>
          <button
            className="vc-crm-primary"
            type="button"
            disabled={saving || !reason.trim()}
            onClick={() => void review()}
          >
            {saving ? 'Saving review…' : 'Save review'}
          </button>
        </fieldset>
      )}
    </section>
  )
}
