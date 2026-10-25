'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Load explicitly selected authorized source pages. */
import { useEffect, useRef, useState } from 'react'
import { ContactPicker, crmRead } from './HouseholdWorkspace'
import type { TemplateRow } from './correspondence'
import { CorrespondenceGeneration } from './CorrespondenceGeneration'
import { EmailDelivery } from './EmailDelivery'
type Choice = { id: string; label: string }
function SourcePicker({
  api,
  site,
  contact,
  kind,
  value,
  onChange,
}: {
  api: string
  site: string
  contact: string
  kind: 'gifts' | 'memberships'
  value: string
  onChange: (id: string) => void
}) {
  const [docs, setDocs] = useState<Choice[]>([]),
    [after, setAfter] = useState(''),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setDocs([])
    setNext(null)
    if (contact)
      void crmRead<{ docs: Choice[]; next: string | null }>(
        `${api}/crm/correspondence?${new URLSearchParams({ view: 'sources', site, contact, kind, after })}`,
        { signal: controller.signal },
      )
        .then((data) => {
          setDocs(data.docs)
          setNext(data.next)
          setError('')
        })
        .catch((cause) => {
          if (cause.name !== 'AbortError') {
            setDocs([])
            setError(cause.message)
          }
        })
    return () => controller.abort()
  }, [api, site, contact, kind, after])
  const label = kind === 'gifts' ? 'Recorded gift' : 'Recorded membership term'
  return (
    <div>
      <label>
        {label}
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Choose a recorded source</option>
          {value && !docs.some((doc) => doc.id === value) && (
            <option value={value}>Selected source</option>
          )}
          {docs.map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={!after} onClick={() => setAfter('')}>
        First {kind}
      </button>
      <button type="button" disabled={!next} onClick={() => setAfter(next!)}>
        Next {kind}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
type Props = {
  api: string
  site: string
  contact?: string
  initialGift?: string
  initialMembership?: string
  supersedes?: string
  onIssued?: () => void
  onDirty?: (value: boolean) => void
  onSaving?: (value: boolean) => void
}
export function CorrespondenceCompose(props: Props) {
  return (
    <DocumentComposer
      key={`${props.api}:${props.site}:${props.contact || ''}:${props.supersedes || ''}:${props.initialGift || ''}:${props.initialMembership || ''}`}
      {...props}
    />
  )
}
function DocumentComposer({
  api,
  site,
  contact: initialContact,
  initialGift,
  initialMembership,
  supersedes,
  onIssued,
  onDirty,
  onSaving,
}: Props) {
  const [contact, setContact] = useState(initialContact || ''),
    [templates, setTemplates] = useState<TemplateRow[]>([]),
    [after, setAfter] = useState(''),
    [next, setNext] = useState<string | null>(null),
    [template, setTemplate] = useState<TemplateRow | null>(null),
    [canEdit, setCanEdit] = useState(false),
    [denied, setDenied] = useState(false)
  const [gift, setGift] = useState(''),
    [membership, setMembership] = useState(''),
    [year, setYear] = useState(String(new Date().getFullYear())),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [issuerName, setIssuerName] = useState(''),
    [issuerAddress, setIssuerAddress] = useState(''),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<{
      approval: string
      snapshot: { subject: string; body: string }
    } | null>(null),
    [issued, setIssued] = useState('')
  const operation = useRef<{ intent: string; key: string } | null>(null)
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    onSaving?.(busy)
  }, [busy, onSaving])
  useEffect(() => {
    const controller = new AbortController()
    void crmRead<{ docs: TemplateRow[]; next: string | null; canEdit: boolean }>(
      `${api}/crm/correspondence?${new URLSearchParams({ site, after })}`,
      { signal: controller.signal },
    )
      .then((data) => {
        setTemplates(data.docs)
        setNext(data.next)
        setCanEdit(data.canEdit)
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') {
          setTemplates([])
          setCanEdit(false)
          setPreview(null)
          setError(cause.message)
          if ([401, 403].includes(cause.status)) setDenied(true)
        }
      })
    return () => controller.abort()
  }, [api, site, after])
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
    setIssued('')
    operation.current = null
  }
  const request = {
    supersedes,
    site,
    contact,
    template: template?.id || '',
    issuedOn: date,
    issuerName,
    issuerAddress,
    gift:
      template?.kind === 'gift-receipt' || template?.kind === 'thank-you'
        ? gift || undefined
        : undefined,
    membership: template?.kind === 'membership-renewal' ? membership || undefined : undefined,
    year: template?.kind === 'annual-statement' ? Number(year) : undefined,
  }
  const prepare = async () => {
    setBusy(true)
    setError('')
    setPreview(null)
    try {
      const data = await crmRead<{ doc: NonNullable<typeof preview> }>(
        `${api}/crm/correspondence`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, action: 'preview-document' }),
        },
      )
      setPreview(data.doc)
    } catch (cause) {
      setError((cause as Error).message)
      if ([401, 403].includes((cause as { status: number }).status)) {
        setDenied(true)
        setCanEdit(false)
        setTemplate(null)
      }
    } finally {
      setBusy(false)
    }
  }
  const issue = async () => {
    if (!preview || busy) return
    const body = { ...request, supersedes, approval: preview.approval, action: 'issue-document' },
      intent = JSON.stringify(body)
    if (operation.current?.intent !== intent)
      operation.current = { intent, key: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      const data = await crmRead<{ doc: { id: string } }>(`${api}/crm/correspondence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationKey: operation.current.key }),
      })
      setIssued(data.doc.id)
      setPreview(null)
      setDirty(false)
      operation.current = null
      onIssued?.()
    } catch (cause) {
      setError((cause as Error).message)
      if ([401, 403].includes((cause as { status: number }).status)) {
        setDenied(true)
        setCanEdit(false)
        setPreview(null)
        setTemplate(null)
      }
    } finally {
      setBusy(false)
    }
  }
  if (denied)
    return (
      <section aria-label="Prepare correspondence">
        <p role="alert">
          {error || 'Document access changed. Reload the authorized chapter to continue.'}
        </p>
      </section>
    )
  return (
    <section className="vc-crm-domain" aria-label="Prepare correspondence">
      <h2>Prepare correspondence</h2>
      <p>
        Review the resolved document before issuance. Issuing saves a historical document; it does
        not send email.
      </p>
      {supersedes && <p>Corrects issued document {supersedes}.</p>}
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || !canEdit || !!issued}>
        {!initialContact && (
          <ContactPicker
            api={api}
            site={site}
            value={contact}
            label="Document recipient"
            onChange={(id) => {
              setContact(id)
              setGift('')
              setMembership('')
              change()
            }}
          />
        )}
        <label>
          Document template
          <select
            value={template?.id || ''}
            onChange={(event) => {
              const selected = templates.find((row) => row.id === event.target.value) || null
              setTemplate(selected)
              setGift(
                selected?.kind === 'gift-receipt' || selected?.kind === 'thank-you'
                  ? gift || (initialContact ? initialGift || '' : '')
                  : '',
              )
              setMembership(
                selected?.kind === 'membership-renewal'
                  ? membership || (initialContact ? initialMembership || '' : '')
                  : '',
              )
              change()
            }}
          >
            <option value="">Choose template</option>
            {template && !templates.some((row) => row.id === template.id) && (
              <option value={template.id}>{template.name}</option>
            )}
            {templates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} · {row.kind} · version {row.revision}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!after} onClick={() => setAfter('')}>
          First document templates
        </button>
        <button type="button" disabled={!next} onClick={() => setAfter(next!)}>
          Next document templates
        </button>
        <label>
          Issuer name
          <input
            value={issuerName}
            maxLength={240}
            onChange={(event) => {
              setIssuerName(event.target.value)
              change()
            }}
          />
        </label>
        <label>
          Issuer address
          <textarea
            value={issuerAddress}
            maxLength={2000}
            onChange={(event) => {
              setIssuerAddress(event.target.value)
              change()
            }}
          />
        </label>
        <label>
          Document date
          <input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              change()
            }}
          />
        </label>
        {template?.kind === 'annual-statement' && (
          <label>
            Statement year
            <input
              type="number"
              min={1900}
              max={9998}
              value={year}
              onChange={(event) => {
                setYear(event.target.value)
                change()
              }}
            />
          </label>
        )}
        {contact && (template?.kind === 'gift-receipt' || template?.kind === 'thank-you') && (
          <SourcePicker
            key={`${contact}:gifts`}
            api={api}
            site={site}
            contact={contact}
            kind="gifts"
            value={gift}
            onChange={(id) => {
              setGift(id)
              change()
            }}
          />
        )}
        {contact && template?.kind === 'membership-renewal' && (
          <SourcePicker
            key={`${contact}:memberships`}
            api={api}
            site={site}
            contact={contact}
            kind="memberships"
            value={membership}
            onChange={(id) => {
              setMembership(id)
              change()
            }}
          />
        )}
        <button
          type="button"
          disabled={!contact || !template || !issuerName.trim() || !date}
          onClick={() => void prepare()}
        >
          Preview resolved document
        </button>
      </fieldset>
      {preview && (
        <section aria-label="Resolved document preview">
          <h3>{preview.snapshot.subject}</h3>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {preview.snapshot.body}
          </div>
          <button type="button" disabled={busy || !canEdit} onClick={() => void issue()}>
            Issue reviewed document
          </button>
        </section>
      )}
      {issued && (
        <p role="status">
          Issued document {issued}.{' '}
          <a
            href={`${api}/crm/correspondence?${new URLSearchParams({ site, document: issued, format: 'html' })}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open issued printable HTML
          </a>
        </p>
      )}
      {!canEdit && <p>Preparing documents requires communications edit access.</p>}
      {issued && (
        <CorrespondenceGeneration
          api={api}
          site={site}
          document={issued}
          onDenied={(message) => {
            setDenied(true)
            setError(message)
            setDirty(false)
            setBusy(false)
          }}
        />
      )}
      {issued && (
        <>
          <EmailDelivery
            api={api}
            site={site}
            document={issued}
            onDirty={setDirty}
            onSaving={setBusy}
            onDenied={(message) => {
              setDenied(true)
              setError(message)
              setDirty(false)
              setBusy(false)
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm('Discard unsaved email delivery changes?')) {
                setIssued('')
                setDirty(false)
                setPreview(null)
              }
            }}
          >
            Prepare another document
          </button>
        </>
      )}
    </section>
  )
}
