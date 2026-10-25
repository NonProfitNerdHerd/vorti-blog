'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Load the explicit authorized document delivery. */
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { EmailOutbox } from './email-outbox'
import { EmailEventHistory } from './EmailEventHistory'
type Context = Awaited<ReturnType<EmailOutbox['context']>>
type Preview = Awaited<ReturnType<EmailOutbox['preview']>>
type Props = {
  api: string
  site: string
  document: string
  onDirty?: (value: boolean) => void
  onSaving?: (value: boolean) => void
  onDenied?: (message: string) => void
}
export function EmailDelivery(props: Props) {
  return <DeliveryEditor key={`${props.api}:${props.site}:${props.document}`} {...props} />
}
function DeliveryEditor({ api, site, document, onDirty, onSaving, onDenied }: Props) {
  const [data, setData] = useState<Context | null>(null),
    [recipient, setRecipient] = useState(''),
    [includePDF, setIncludePDF] = useState(false),
    [providerID, setProviderID] = useState(''),
    [preview, setPreview] = useState<Preview | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0)
  const operation = useRef<{ intent: string; key: string } | null>(null),
    denied = useRef(onDenied)
  useEffect(() => {
    denied.current = onDenied
  }, [onDenied])
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    onSaving?.(busy || loading)
  }, [busy, loading, onSaving])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void crmRead<Context>(
      `${api}/crm/email-deliveries?${new URLSearchParams({ site, document })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setRecipient((current) =>
          result.recipients.includes(current) ? current : result.recipients[0] || '',
        )
        setProviderID((current) => current || result.delivery?.providerID || '')
        setError('')
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        setData(null)
        setPreview(null)
        setError(cause.message)
        if ([401, 403].includes(cause.status)) {
          setDirty(false)
          denied.current?.(cause.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [api, site, document, refresh])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, busy])
  const change = () => {
    setDirty(true)
    setPreview(null)
    operation.current = null
  }
  const post = async (
    action: 'preview-email' | 'queue-email' | 'reconcile-email' | 'cancel-email' | 'retry-email',
  ) => {
    if (!data || busy || loading) return
    const body = {
        site,
        document,
        action,
        recipient,
        includePDF,
        approval: preview?.approval,
        id: data.delivery?.id,
        providerID,
        expectedRevision: data.delivery?.revision,
      },
      intent = JSON.stringify(body)
    if (operation.current?.intent !== intent)
      operation.current = { intent, key: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      const result = await crmRead<{ doc: Preview }>(`${api}/crm/email-deliveries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationKey: operation.current.key }),
      })
      if (action === 'preview-email') {
        setPreview(result.doc)
        setDirty(true)
      } else {
        setPreview(null)
        setDirty(false)
        setLoading(true)
        setRefresh((value) => value + 1)
      }
      operation.current = null
    } catch (cause) {
      setError((cause as Error).message)
      if ([401, 403].includes((cause as { status: number }).status)) {
        setData(null)
        setPreview(null)
        setDirty(false)
        denied.current?.((cause as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }
  const reload = () => {
    if (!busy && (!dirty || window.confirm('Discard unsaved email delivery changes?'))) {
      setDirty(false)
      setPreview(null)
      setProviderID('')
      setRefresh((value) => value + 1)
    }
  }
  return (
    <section className="vc-crm-domain" aria-label="Email delivery">
      <h3>Email delivery</h3>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading delivery status…</p>}
      {data && (
        <>
          {!data.configured && (
            <p>
              Email sending is unavailable or unconfigured for this record. Printing and private PDF
              downloads remain available.
            </p>
          )}
          {!data.emailAllowed && <p>This recipient does not permit email correspondence.</p>}
          {!data.delivery && data.emailAllowed && !data.recipients.length && (
            <p>No supported email address is recorded for this recipient.</p>
          )}
          {data.superseded && (
            <p>This document was superseded. Use its correction for new correspondence.</p>
          )}
          {data.delivery ? (
            <>
              <p role="status">
                Delivery {data.delivery.status} · Recorded send attempts: {data.delivery.attempts}
              </p>
              <p>
                To: {data.delivery.recipient}
                <br />
                From: {data.delivery.from}
              </p>
              {data.delivery.error && <p>{data.delivery.error}</p>}
              {!data.superseded &&
                !data.canRetry &&
                ['failed', 'cancelled', 'uncertain'].includes(data.delivery.status) && (
                  <p>
                    For changed recipient or sender details, open issued correspondence history and
                    choose Prepare correction. Review the replacement document and email before
                    queuing it. The original document and delivery history are retained.
                  </p>
                )}
              {data.delivery.status === 'uncertain' && (
                <p>
                  The provider may already have accepted this message. Reconcile its provider
                  outcome before queuing a replacement to avoid duplicate correspondence.
                </p>
              )}
              {data.delivery.cancelRequested && (
                <p>
                  {data.delivery.firstAttemptAt
                    ? 'Cancellation was requested. An in-flight message may already have been accepted.'
                    : 'Cancelled before dispatch.'}
                </p>
              )}
              <fieldset disabled={busy || loading}>
                {data.canCancel && (
                  <button type="button" onClick={() => void post('cancel-email')}>
                    Cancel email delivery
                  </button>
                )}
                {data.canRetry && (
                  <button type="button" onClick={() => void post('retry-email')}>
                    Retry unchanged email
                  </button>
                )}
                {data.canReconcile && (
                  <>
                    <label>
                      Provider message ID
                      <input
                        value={providerID}
                        maxLength={36}
                        onChange={(event) => {
                          setProviderID(event.target.value)
                          change()
                        }}
                      />
                    </label>
                    <p>
                      Reconciliation reads the provider record and verifies this delivery&apos;s
                      exact content. It does not send another email.
                    </p>
                    <button
                      type="button"
                      disabled={!providerID}
                      onClick={() => void post('reconcile-email')}
                    >
                      Reconcile provider outcome
                    </button>
                  </>
                )}
              </fieldset>
            </>
          ) : (
            data.canQueue && (
              <fieldset disabled={busy || loading}>
                <label>
                  Email recipient
                  <select
                    value={recipient}
                    onChange={(event) => {
                      setRecipient(event.target.value)
                      change()
                    }}
                  >
                    {data.recipients.map((address) => (
                      <option key={address}>{address}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={includePDF}
                    disabled={!data.pdfReady}
                    onChange={(event) => {
                      setIncludePDF(event.target.checked)
                      change()
                    }}
                  />{' '}
                  Attach issued PDF
                </label>
                {!data.pdfReady && (
                  <p>PDF generation must finish before an attachment can be selected.</p>
                )}
                <button
                  type="button"
                  disabled={!recipient}
                  onClick={() => void post('preview-email')}
                >
                  Preview email delivery
                </button>
              </fieldset>
            )
          )}
          {preview && (
            <section aria-label="Reviewed email preview">
              <p>
                From: {preview.from}
                <br />
                To: {preview.recipient}
              </p>
              <h4>{preview.subject}</h4>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview.text}</div>
              <p>
                {preview.attachment
                  ? `Attachment: ${preview.attachment.filename} (${preview.attachment.bytes} bytes)`
                  : 'No PDF attachment.'}
              </p>
              <p>{preview.deliveryReference}</p>
              <button
                type="button"
                disabled={busy || loading || !data.canQueue}
                onClick={() => void post('queue-email')}
              >
                Queue reviewed email
              </button>
            </section>
          )}
        </>
      )}
      <button type="button" disabled={busy || loading} onClick={reload}>
        Refresh email delivery
      </button>
      {data?.delivery && (
        <EmailEventHistory
          api={api}
          site={site}
          id={data.delivery.id}
          refresh={refresh}
          onDenied={(message) => {
            setData(null)
            setPreview(null)
            setDirty(false)
            setError(message)
            denied.current?.(message)
          }}
        />
      )}
    </section>
  )
}
