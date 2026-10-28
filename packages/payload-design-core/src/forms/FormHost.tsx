'use client'
import { usePublicFetch, usePublicSitePath, usePublicRequestHeaders } from '../PublicSiteContext'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormRenderer, type FormRendererProps } from './FormRenderer'
import type { BookingAdapter, BookingOption, BookingSelection } from './BookingInput'
import type { Answers, FormDefinition, FormIssue } from './model'
import { SavedDrafts } from './SavedDrafts'
import { SurveyResults } from './SurveyResults'
import { PaymentPanel } from './PaymentPanel'

interface PublicForm { title: string; description?: string; revision: string; definition: FormDefinition; session: string; answers?: Answers; draftID?: number; resumeToken?: string }
/** Reusable public placement. Each instance owns its session and retry key. Answers are never put in browser storage. */
export function FormHost({ slug, embedded = false }: { slug: string; embedded?: boolean }) {
  return <FormInstance key={slug} slug={slug} embedded={embedded} />
}
function FormInstance({ slug, embedded }: { slug: string; embedded: boolean }) {
  const publicFetch = usePublicFetch(), publicPath = usePublicSitePath(), requestHeaders = usePublicRequestHeaders()
  const [form, setForm] = useState<PublicForm>(), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [receipt, setReceipt] = useState(''), [receiptURL, setReceiptURL] = useState('')
  const [payment, setPayment] = useState('')
  const returnedPayment = useRef('')
  useEffect(() => () => { if (receiptURL) URL.revokeObjectURL(receiptURL) }, [receiptURL])
  const retryKey = useRef<string>('')
  const analyticsConsent = useRef(false)
  const consentChanged = useCallback((value: boolean) => { analyticsConsent.current = value }, [])
  const holds = useRef<Record<string, BookingSelection & { field: string }>>({})
  const resumeToken = useRef<string>(''), autosave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve())
  const activeDraftID = useRef<number | undefined>(undefined), revoking = useRef(false)
  const stopped = useRef(false)
  const [resumePath, setResumePath] = useState(''), [saveState, setSaveState] = useState('')
  const [resumeEmail, setResumeEmail] = useState(''), [emailBusy, setEmailBusy] = useState(false)
  useEffect(() => {
    const changed = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('payment')
      if (!token) return
      returnedPayment.current = token; setPayment(token)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams(window.location.hash.slice(1)), token = params.get('resume')
    const paymentReturn = params.get('payment') || returnedPayment.current
    if (paymentReturn) {
      returnedPayment.current = paymentReturn; setPayment(paymentReturn)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      return () => controller.abort()
    }
    if (token) { resumeToken.current = token; window.history.replaceState(null, '', window.location.pathname + window.location.search) }
    const resumable = token || resumeToken.current
    publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}${resumable ? '/resume' : ''}`, { signal: controller.signal, credentials: 'same-origin', ...(resumable ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resumable }) } : {}) }).then(async response => {
      const body = await response.json() as PublicForm & { message?: string }
      if (!response.ok) throw new Error(body.message || 'Could not load this form.')
      if (controller.signal.aborted) return
      activeDraftID.current = body.draftID
      if (resumable && body.draftID) {
        resumeToken.current = body.resumeToken || resumable
        setResumePath(new URL(publicPath(`/forms/${encodeURIComponent(slug)}#resume=${resumeToken.current}`), window.location.origin).href)
      }
      setForm(body); setReceipt(''); setReceiptURL(''); retryKey.current = crypto.randomUUID(); holds.current = {}; setError('')
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => { controller.abort(); if (autosave.current) clearTimeout(autosave.current) }
  }, [slug, retry, publicFetch, publicPath])
  const booking = useMemo<BookingAdapter | undefined>(() => {
    if (!form) return undefined
    async function request(field: string, operation: Record<string, unknown>) {
      const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/booking`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Form-Session': form!.session }, body: JSON.stringify({ revision: form!.revision, field, ...operation }) })
      const result = await response.json() as BookingSelection & { message?: string; slots: BookingOption[] }
      if (!response.ok) throw new Error(result.message || 'Could not update this reservation.')
      return result
    }
    return {
      load: async (field, from, to) => (await request(field.id, { operation: 'list', from, to })).slots,
      reserve: async (field, path, slot) => {
        const selected = await request(field.id, { operation: 'hold', slot }), old = holds.current[path]
        holds.current[path] = { ...selected, field: field.id }
        // Keep the new reservation if releasing an earlier hold temporarily fails; the old hold expires.
        if (old) await request(old.field, { operation: 'release', token: old.token }).catch(() => {})
        return selected
      },
      release: async (_field, path) => { const old = holds.current[path]; if (old) { await request(old.field, { operation: 'release', token: old.token }); delete holds.current[path] } },
      selected: path => holds.current[path],
    }
  }, [form, slug, publicFetch])
  const analytics = useCallback<NonNullable<FormRendererProps['onEvent']>>((kind, metadata) => {
    if (!form || kind === 'accepted') return
    void publicFetch('/api/forms-runtime/' + encodeURIComponent(slug) + '/analytics', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session },
      body: JSON.stringify({ revision: form.revision, eventID: crypto.randomUUID(), kind, ...metadata }),
    }).catch(() => {})
  }, [form, slug])
  const receiptControls = form && receipt && <p><button type="button" onClick={async () => {
    try {
      const response = await publicFetch('/api/forms-runtime/' + encodeURIComponent(slug) + '/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session }, body: JSON.stringify({ revision: form.revision, receipt }) })
      if (!response.ok) throw new Error('The receipt could not be loaded. Please retry.')
      setReceiptURL(URL.createObjectURL(await response.blob()))
    } catch (error) { setSaveState((error as Error).message) }
  }}>Prepare printable receipt</button>{receiptURL && <a href={receiptURL} target="_blank" rel="noopener noreferrer">Open receipt / save as PDF</a>}</p>
  if (error) return <section aria-label="Form unavailable"><p role="alert">{error}</p><button type="button" onClick={() => setRetry(n => n + 1)}>Retry loading form</button></section>
  if (payment) return <><PaymentPanel key={payment} token={payment} />{receiptControls}<p role="status">{saveState}</p></>
  if (!form) return <p role="status">Loading form…</p>
  const save = async (answers: Answers) => {
    const operation = pendingSave.current.catch(() => {}).then(async () => {
    if (stopped.current) return { message: 'This form has already been submitted.' }
    if (revoking.current) return { message: 'Wait for draft revocation to finish, then save your current answers.' }
    setSaveState('Saving progress…')
    const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/progress`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session }, body: JSON.stringify({ revision: form.revision, answers, resumeToken: resumeToken.current || undefined }) })
    const body = await response.json() as { message: string; draftID: number; resumeToken: string; resumePath: string }
    if (!response.ok) { setSaveState(body.message || 'Progress could not be saved.'); throw new Error(body.message) }
    activeDraftID.current = body.draftID; resumeToken.current = body.resumeToken; setResumePath(new URL(publicPath(body.resumePath), window.location.origin).href); setSaveState('Progress saved.')
    return { message: body.message }
    })
    pendingSave.current = operation
    return operation
  }
  const revoke = async (id?: number): Promise<string> => {
    revoking.current = true
    if (autosave.current) clearTimeout(autosave.current)
    try {
      await pendingSave.current.catch(() => {})
      const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id === undefined ? { token: resumeToken.current } : { id }) })
      const body = await response.json() as { message: string }
      if (!response.ok) throw new Error(body.message)
      if (id === undefined || id === activeDraftID.current) {
        activeDraftID.current = undefined; resumeToken.current = ''; setResumePath(''); setResumeEmail('')
        setSaveState('Saved draft revoked. Your current answers remain here; Save progress creates a new private draft.')
      }
      return body.message
    } finally { revoking.current = false }
  }
  return <section>{embedded ? <h2>{form.title}</h2> : <h1>{form.title}</h1>}{form.description && <p>{form.description}</p>}<SavedDrafts slug={slug} refresh={resumePath} onRevoke={revoke} onResume={async id => {
    if (!window.confirm('Resume this draft and replace the answers currently on this page?')) return false
    if (autosave.current) clearTimeout(autosave.current)
    await pendingSave.current.catch(() => {})
    const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    const body = await response.json() as PublicForm & { message: string; resumeToken: string }
    if (!response.ok) throw new Error(body.message)
    activeDraftID.current = body.draftID; resumeToken.current = body.resumeToken; stopped.current = false; setForm(body); retryKey.current = crypto.randomUUID(); holds.current = {}; setReceipt(''); setReceiptURL('')
    setResumePath(new URL(publicPath(`/forms/${encodeURIComponent(slug)}#resume=${body.resumeToken}`), window.location.origin).href); setSaveState('Saved draft resumed.')
    return true
  }} />{(!receipt || form.definition.graph?.enabled) && <FormRenderer key={`${form.revision}:${form.session}`} definition={form.definition} initialAnswers={form.answers} booking={booking} onEvent={analytics} onAnalyticsConsent={consentChanged} onSave={save} onChange={answers => {
    if (form.definition.access.autosaveProgress && !revoking.current) { if (autosave.current) clearTimeout(autosave.current); autosave.current = setTimeout(() => { void save(answers).catch(() => {}) }, 2000) }
  }} onUpload={(file, field, progress) => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest(); request.open('POST', publicPath(`/api/forms-runtime/${encodeURIComponent(slug)}/upload`))
    new Headers(requestHeaders(`/api/forms-runtime/${encodeURIComponent(slug)}/upload`)).forEach((value, name) => request.setRequestHeader(name, value))
    request.setRequestHeader('Content-Type', file.type); request.setRequestHeader('X-Form-Session', form.session); request.setRequestHeader('X-Form-Revision', form.revision); request.setRequestHeader('X-Form-Field', field.id); request.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
    request.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)) }
    request.onerror = () => reject(new Error('Upload failed. Please retry.'))
    request.onload = () => { try { const body = JSON.parse(request.responseText); if (request.status >= 400) reject(new Error(body.message || 'Upload failed.')); else resolve(body) } catch { reject(new Error('Invalid upload response.')) } }
    request.send(file)
  })} onSubmit={async (answers, navigation) => {
    if (autosave.current) clearTimeout(autosave.current)
    await pendingSave.current.catch(() => {})
    const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/submit`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session }, body: JSON.stringify({ revision: form.revision, idempotencyKey: retryKey.current, answers, navigation, analyticsConsent: analyticsConsent.current, bookings: Object.fromEntries(Object.entries(holds.current).map(([path, hold]) => [path, hold.token])), website: '' }) })
    const body = await response.json() as { message?: string; errors?: FormIssue[]; redirect?: string; analyticsRecorded?: boolean; receipt?: string; payment?: { token: string } }
    if (!response.ok && !body.errors) throw new Error(body.message || 'Could not submit. Please retry.')
    if (body.receipt) { stopped.current = true; setReceipt(body.receipt); setSaveState(body.message || 'Your response has been received.') }
    if (response.ok && body.payment?.token) setPayment(body.payment.token)
    return body
  }}  />}{receiptControls}<p role="status">{saveState}</p>{resumePath && <div><label>Private resume link — anyone with this link can access anonymous saved answers.<input readOnly value={resumePath} onFocus={e => e.target.select()} style={{ width: '100%' }} /></label><button type="button" onClick={async () => {
    if (!window.confirm('Revoke this private resume link? Your current answers will remain on this page.')) return
    try {
      await revoke()
    } catch (error) { setSaveState((error as Error).message) }
  }}>Revoke private resume link</button><div><label>Email this private link<input type="email" autoComplete="email" value={resumeEmail} onChange={event => setResumeEmail(event.target.value)} /></label><button type="button" disabled={emailBusy || !resumeEmail.trim()} onClick={async () => {
    setEmailBusy(true)
    try {
      await pendingSave.current.catch(() => {})
      const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/progress-email`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session }, body: JSON.stringify({ revision: form.revision, token: resumeToken.current, email: resumeEmail }) })
      const body = await response.json() as { message: string }
      if (!response.ok) throw new Error(body.message)
      setSaveState(body.message)
    } catch (error) { setSaveState((error as Error).message) } finally { setEmailBusy(false) }
  }}>{emailBusy ? 'Queuing email…' : 'Email resume link'}</button></div></div>}{form.definition.access.publicResults && <details><summary>View survey results</summary><SurveyResults endpoint={publicPath(`/api/forms-surveys/${encodeURIComponent(slug)}?lookup=slug`)} /></details>}</section>
}
