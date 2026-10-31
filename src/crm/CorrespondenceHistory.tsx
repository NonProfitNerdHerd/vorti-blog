'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Fetch the explicit authorized history context. */
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import { CorrespondenceGeneration } from './CorrespondenceGeneration'
import { EmailDelivery } from './EmailDelivery'
type HistoryRow = {
  id: string
  constituent_id: string
  recipient: string
  kind: string
  subject: string
  issued_on: string
  created_at: string
  supersedes_id: string | null
  superseded_by: string | null
  pdf_ready: number
}
type DocumentDetail = {
  id: string
  subject: string
  body: string
  issued_on: string
  supersedes_id: string | null
}
type HistoryProps = {
  api: string
  site: string
  contact?: string
  refresh?: number
  onCorrect?: (id: string, contact: string) => void
  onDirty?: (value: boolean) => void
  onSaving?: (value: boolean) => void
}
export function CorrespondenceHistory(props: HistoryProps) {
  return <DocumentHistory key={`${props.api}:${props.site}:${props.contact || ''}`} {...props} />
}
function DocumentHistory({
  api,
  site,
  contact,
  refresh = 0,
  onCorrect,
  onDirty,
  onSaving,
}: HistoryProps) {
  const [docs, setDocs] = useState<HistoryRow[]>([]),
    [before, setBefore] = useState<{ date: string; id: string } | null>(null),
    [next, setNext] = useState<{ date: string; id: string } | null>(null),
    [detail, setDetail] = useState<DocumentDetail | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [canIssue, setCanIssue] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    onSaving?.(busy)
  }, [busy, onSaving])
  const discard = () =>
    !busy && (!dirty || window.confirm('Discard unsaved email delivery changes?'))
  const generation = useRef(0),
    detailGeneration = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setLoading(true)
    setDetail(null)
    detailGeneration.current++
    void crmRead<{
      docs: HistoryRow[]
      next: { date: string; id: string } | null
      canIssue: boolean
    }>(
      `${api}/crm/correspondence?${new URLSearchParams({ view: 'documents', site, contact: contact || '', beforeDate: before?.date || '', beforeID: before?.id || '' })}`,
    )
      .then((data) => {
        if (current === generation.current) {
          setDocs(data.docs)
          setCanIssue(data.canIssue)
          setNext(data.next)
          setError('')
        }
      })
      .catch((cause) => {
        if (current === generation.current) {
          setDocs([])
          setCanIssue(false)
          setNext(null)
          setDetail(null)
          setError((cause as Error).message)
        }
      })
      .finally(() => {
        if (current === generation.current) setLoading(false)
      })
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- These counters invalidate outstanding requests rather than track DOM elements.
      generation.current++
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate detail reads on a changed chapter or page.
      detailGeneration.current++
    }
  }, [api, site, contact, before, refresh])
  const open = async (id: string) => {
    if (!discard()) return
    setDirty(false)
    const current = ++detailGeneration.current
    setDetail(null)
    try {
      const data = await crmRead<{ doc: DocumentDetail }>(
        `${api}/crm/correspondence?${new URLSearchParams({ site, document: id })}`,
      )
      if (current === detailGeneration.current) {
        setDetail(data.doc)
        setError('')
      }
    } catch (cause) {
      if (current === detailGeneration.current) {
        setDetail(null)
        setError((cause as Error).message)
      }
    }
  }
  return (
    <section className="vc-crm-domain vc-crm-documents-layout" aria-label="Issued correspondence history">
      <div className="vc-crm-documents-main">
      <h2>Issued correspondence</h2>
      <p>
        Documents retain the recipient, template version and recorded balances used at issuance.
        Corrections retain their original document.
      </p>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading authorized documents…</p>}
      <div className="vc-crm-table-wrap"><table>
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Subject</th>
            <th>Issued</th>
            <th>History</th>
            <th>Document</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.id}>
              <td>{doc.recipient}</td>
              <td>{doc.subject}</td>
              <td>{doc.issued_on}</td>
              <td>
                {doc.superseded_by
                  ? 'Superseded by a correction'
                  : doc.supersedes_id
                    ? 'Corrected document'
                    : 'Original'}
              </td>
              <td>
                <button type="button" disabled={busy} onClick={() => void open(doc.id)}>
                  Open document {doc.id}
                </button>
                {!!doc.pdf_ready && (
                  <a
                    href={`${api}/crm/correspondence?${new URLSearchParams({ site, document: doc.id, format: 'pdf' })}`}
                  >
                    Download PDF for {doc.id}
                  </a>
                )}
                {canIssue && onCorrect && !doc.superseded_by && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (discard()) {
                        setDirty(false)
                        onCorrect(doc.id, doc.constituent_id)
                      }
                    }}
                  >
                    Prepare correction for {doc.id}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!loading && !docs.length && <p>No authorized issued documents match this selection.</p>}
      <div className="vc-crm-toolbar">
        <button
          type="button"
          disabled={!before || loading || busy}
          onClick={() => {
            if (discard()) {
              setDirty(false)
              setBefore(null)
            }
          }}
        >
          First documents
        </button>
        <button
          type="button"
          disabled={!next || loading || busy}
          onClick={() => {
            if (discard()) {
              setDirty(false)
              setBefore(next)
            }
          }}
        >
          Older documents
        </button>
      </div>
      </div>
      <aside className="vc-crm-document-preview" aria-label="Document preview">
      {detail && (
        <section aria-label="Issued document">
          <h3>{detail.subject}</h3>
          <p>
            Document {detail.id} · {detail.issued_on}
          </p>
          {detail.supersedes_id && <p>Corrects document {detail.supersedes_id}</p>}
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.body}</div>
          <EmailDelivery
            api={api}
            site={site}
            document={detail.id}
            onDirty={setDirty}
            onSaving={setBusy}
            onDenied={(message) => {
              detailGeneration.current++
              setDetail(null)
              setDocs([])
              setDirty(false)
              setBusy(false)
              setError(message)
            }}
          />
          <CorrespondenceGeneration
            api={api}
            site={site}
            document={detail.id}
            onDenied={(message) => {
              detailGeneration.current++
              setDetail(null)
              setDocs([])
              setDirty(false)
              setBusy(false)
              setError(message)
            }}
          />
          <a
            href={`${api}/crm/correspondence?${new URLSearchParams({ site, document: detail.id, format: 'html' })}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open printable HTML
          </a>
          <button
            type="button"
            onClick={() => {
              if (!discard()) return
              setDirty(false)
              detailGeneration.current++
              setDetail(null)
            }}
          >
            Close document
          </button>
        </section>
      )}
      {!detail && <p>Select an issued document to preview its details.</p>}
      </aside>
    </section>
  )
}
