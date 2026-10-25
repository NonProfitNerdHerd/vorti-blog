'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Read the explicitly pinned private record context. */
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { CRMRecordLink } from './record-model'
import type { CRMAttachments } from './attachments'
import { attachmentMetadata, crmAttachmentLimit } from './attachment-model'

type Page = Awaited<ReturnType<CRMAttachments['list']>>
type FileRow = Page['docs'][number]
type Props = {
  api: string
  site: string
  link: CRMRecordLink
  onDirty?: (value: boolean) => void
  onSaving?: (value: boolean) => void
  onDenied?: (message: string) => void
}
export function AttachmentWorkspace(props: Props) {
  return (
    <PrivateAttachments
      key={`${props.api}:${props.site}:${props.link.type}:${props.link.id}`}
      {...props}
    />
  )
}
function PrivateAttachments({ api, site, link, onDirty, onSaving, onDenied }: Props) {
  const [page, setPage] = useState<Page | null>(null),
    [archived, setArchived] = useState(false),
    [before, setBefore] = useState<Page['next']>(null),
    [file, setFile] = useState<File | null>(null),
    [category, setCategory] = useState(''),
    [resume, setResume] = useState<FileRow | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [refresh, setRefresh] = useState(0),
    [inputVersion, setInputVersion] = useState(0)
  const operation = useRef<{
    intent: string
    stage: string
    upload: string
    id?: string
    revision: number
  } | null>(null)
  const controlOperation = useRef<{ intent: string; key: string } | null>(null),
    denied = useRef(onDenied)
  const dirty = !!file || !!category || !!resume
  useEffect(() => {
    denied.current = onDenied
  }, [onDenied])
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    onSaving?.(busy || loading)
  }, [busy, loading, onSaving])
  const query = () => new URLSearchParams({ site, recordType: link.type, recordID: link.id })
  const clearDraft = () => {
    setFile(null)
    setCategory('')
    setResume(null)
    operation.current = null
    setInputVersion((v) => v + 1)
  }
  const fail = (cause: Error & { status?: number }) => {
    setError(cause.message)
    if ([401, 403].includes(cause.status || 0)) {
      setPage(null)
      clearDraft()
      setBusy(false)
      denied.current?.(cause.message)
    }
  }
  const discard = () =>
    !busy && (!dirty || window.confirm('Discard unsaved attachment upload changes?'))
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const params = new URLSearchParams({
      site,
      recordType: link.type,
      recordID: link.id,
      archived: String(archived),
      beforeDate: before?.date || '',
      beforeID: before?.id || '',
    })
    void crmRead<Page>(`${api}/crm/attachments?${params}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setPage(result)
        setError('')
        if (category && !result.categories.includes(category as Page['categories'][number]))
          clearDraft()
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setPage(null)
          fail(cause)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Draft changes do not refetch lists or discard a selected local file.
  }, [api, site, link.type, link.id, archived, before, refresh])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const focus = () => {
      if (!busy) setRefresh((v) => v + 1)
    }
    window.addEventListener('beforeunload', guard)
    window.addEventListener('focus', focus)
    return () => {
      window.removeEventListener('beforeunload', guard)
      window.removeEventListener('focus', focus)
    }
  }, [dirty, busy])
  const upload = async () => {
    if (!file || !category || busy || loading) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (file.size < 1 || file.size > crmAttachmentLimit)
        throw new Error('Choose a supported attachment up to 25 MiB.')
      const bytes = await file.arrayBuffer(),
        sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('')
      const values = attachmentMetadata({
        filename: resume?.filename || file.name,
        size: file.size,
        sha256,
        category,
      })
      if (resume && (resume.bytes !== file.size || resume.sha256 !== sha256))
        throw new Error('Choose the original file to resume this upload.')
      const intent = JSON.stringify({ site, link, values, resume: resume?.id || null })
      if (operation.current?.intent !== intent)
        operation.current = {
          intent,
          stage: crypto.randomUUID(),
          upload: crypto.randomUUID(),
          id: resume?.id,
          revision: resume?.revision || 1,
        }
      const current = operation.current
      if (!current.id) {
        const result = await crmRead<{ doc: { id: string; revision: number } }>(
          `${api}/crm/attachments`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              site,
              recordType: link.type,
              recordID: link.id,
              action: 'stage',
              operationKey: current.stage,
              values,
            }),
          },
        )
        current.id = result.doc.id
        current.revision = result.doc.revision
      }
      const params = query()
      params.set('id', current.id)
      await crmRead(`${api}/crm/attachments/content?${params}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-CRM-Operation-Key': current.upload,
          'X-CRM-Revision': String(current.revision),
        },
        body: bytes,
      })
      clearDraft()
      setNotice('Private attachment uploaded.')
      setBefore(null)
      setRefresh((v) => v + 1)
    } catch (cause) {
      fail(cause as Error)
    } finally {
      setBusy(false)
    }
  }
  const control = async (row: FileRow, action: 'archive' | 'restore' | 'cancel') => {
    if (busy || loading) return
    const body = {
        site,
        recordType: link.type,
        recordID: link.id,
        id: row.id,
        expectedRevision: row.revision,
        action,
      },
      intent = JSON.stringify(body)
    if (controlOperation.current?.intent !== intent)
      controlOperation.current = { intent, key: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      await crmRead(`${api}/crm/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationKey: controlOperation.current.key }),
      })
      controlOperation.current = null
      setRefresh((v) => v + 1)
      setNotice(
        `Attachment ${action === 'archive' ? 'archived' : action === 'restore' ? 'restored' : 'upload cancelled'}.`,
      )
      if (resume?.id === row.id) clearDraft()
    } catch (cause) {
      fail(cause as Error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="vc-crm-domain" aria-label="Private CRM attachments">
      <h2>Private attachments</h2>
      {page && <p>Related record: {page.record.label}</p>}
      <p>
        Files require both record access and their selected information category. Archived published
        files remain available in history.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading authorized attachments…</p>}
      <label>
        <input
          type="checkbox"
          checked={archived}
          disabled={busy || loading}
          onChange={(event) => {
            if (discard()) {
              clearDraft()
              setArchived(event.target.checked)
              setBefore(null)
            }
          }}
        />
        Archived attachments
      </label>
      {!!page?.categories.length && !archived && (
        <fieldset disabled={busy || loading}>
          <legend>{resume ? 'Resume private upload' : 'Upload private attachment'}</legend>
          {resume && <p>Resume {resume.filename} by selecting the original file.</p>}
          <label>
            Attachment information category
            <select
              value={category}
              disabled={!!resume}
              onChange={(event) => {
                setCategory(event.target.value)
                operation.current = null
              }}
            >
              <option value="">Choose category</option>
              {page.categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Attachment file
            <input
              key={inputVersion}
              type="file"
              accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.docx,.xlsx,.zip"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null)
              }}
            />
          </label>
          <p>
            Supported files up to 25 MiB. Interrupted staged uploads can be resumed for 24 hours.
          </p>
          <button type="button" disabled={!file || !category} onClick={() => void upload()}>
            {busy
              ? 'Uploading private attachment…'
              : resume
                ? 'Resume selected upload'
                : 'Upload private attachment'}
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => {
                if (discard()) clearDraft()
              }}
            >
              Discard upload selection
            </button>
          )}
        </fieldset>
      )}
      <table>
        <thead>
          <tr>
            <th>Filename</th>
            <th>Category</th>
            <th>Size</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {page?.docs.map((row) => (
            <tr key={row.id}>
              <td>{row.filename}</td>
              <td>{row.category}</td>
              <td>{row.bytes.toLocaleString()} bytes</td>
              <td>{row.state}</td>
              <td>
                {['ready', 'archived'].includes(row.state) && (
                  <a
                    href={`${api}/crm/attachments/content?${new URLSearchParams({ site, recordType: link.type, recordID: link.id, id: row.id })}`}
                  >
                    Download {row.filename}
                  </a>
                )}
                {row.canEdit && row.state === 'ready' && (
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void control(row, 'archive')}
                  >
                    Archive {row.filename}
                  </button>
                )}
                {row.canEdit && row.state === 'archived' && (
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void control(row, 'restore')}
                  >
                    Restore {row.filename}
                  </button>
                )}
                {row.canEdit && row.state === 'staged' && (
                  <>
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() => {
                        if (discard()) {
                          clearDraft()
                          setResume(row)
                          setCategory(row.category)
                        }
                      }}
                    >
                      Resume upload {row.filename}
                    </button>
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() => void control(row, 'cancel')}
                    >
                      Cancel upload {row.filename}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && page && !page.docs.length && (
        <p>No authorized attachments match this selection.</p>
      )}
      <div className="vc-crm-toolbar">
        <button
          type="button"
          disabled={busy || loading || !before}
          onClick={() => {
            if (discard()) {
              clearDraft()
              setBefore(null)
            }
          }}
        >
          First attachments
        </button>
        <button
          type="button"
          disabled={busy || loading || !page?.next}
          onClick={() => {
            if (discard()) {
              clearDraft()
              setBefore(page!.next)
            }
          }}
        >
          Older attachments
        </button>
        <button type="button" disabled={busy || loading} onClick={() => setRefresh((v) => v + 1)}>
          Refresh attachments
        </button>
      </div>
    </section>
  )
}
