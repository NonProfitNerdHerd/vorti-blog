'use client'
import { ContactInput } from './ContactInput'
import { RankingInput } from './RankingInput'
import { widthFraction, widthStyle } from './contact'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { evaluateForm, validateAnswers } from './engine'
import { formFields } from './registry'
import { flattenFields, isEmpty, type Answers, type FormDefinition, type FormField, type FormIssue, type FormValue } from './model'
import './forms.css'
import { wallTimeToInstant, zonedParts } from './dates'
import { BookingInput, type BookingAdapter } from './BookingInput'
import { FormColumns } from './FormColumns'

// Called from telemetry effects and interaction handlers, never to derive rendered output.
const measurementTime = () => Date.now()

export interface UploadResult { id: string; name: string; status: 'unscanned' | 'pending' | 'clean' | 'rejected' | 'error' }
export interface FormRendererProps {
  definition: FormDefinition
  initialAnswers?: Answers
  preview?: boolean
  disabled?: boolean
  onChange?: (answers: Answers) => void
  onSubmit?: (answers: Answers) => Promise<{ message?: string; errors?: FormIssue[]; redirect?: string; analyticsRecorded?: boolean }>
  onSave?: (answers: Answers) => Promise<{ message: string }>
  onUpload?: (file: File, field: FormField, progress: (percent: number) => void) => Promise<UploadResult>
  onEvent?: (type: 'view' | 'start' | 'step' | 'step-exit' | 'error' | 'accepted', metadata: { step?: string; fields?: string[]; durationMs?: number; consent?: boolean }) => void
  onAnalyticsConsent?: (consent: boolean) => void
  showLogic?: boolean
  booking?: BookingAdapter
}
export interface FieldInputProps {
  field: FormField; value: FormValue | undefined; onChange: (value: FormValue) => void
  id: string; disabled?: boolean; describedBy?: string; invalid?: boolean
  onUpload?: FormRendererProps['onUpload']
}
export const fieldRenderers = new Map<string, React.ComponentType<FieldInputProps>>()
export function registerFieldRenderer(kind: string, renderer: React.ComponentType<FieldInputProps>): void {
  if (fieldRenderers.has(kind)) throw new Error(`Renderer already exists: ${kind}`)
  fieldRenderers.set(kind, renderer)
}
const TextInput = ({ field, value, onChange, id, disabled, describedBy, invalid }: FieldInputProps) => {
  const props = { id, disabled, 'aria-describedby': describedBy, 'aria-invalid': invalid, placeholder: field.placeholder,
    value: typeof value === 'string' || typeof value === 'number' ? value : '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(formFields.get(field.kind)?.numeric ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value) }
  return field.kind === 'textarea' || field.kind === 'content' ? <textarea {...props} rows={4} /> :
    <input {...props} type={field.kind === 'slider' ? 'range' : formFields.get(field.kind)?.input || 'text'} min={field.min} max={field.max} step={field.kind === 'currency' ? '0.01' : 'any'} />
}
const CheckboxInput = ({ field, value, onChange, id, disabled, describedBy, invalid }: FieldInputProps) => <label className="forms-check"><input type="checkbox" id={id} checked={value === true} disabled={disabled} aria-describedby={describedBy} aria-invalid={invalid} onChange={e => onChange(e.target.checked)} />{field.placeholder || 'I agree'}</label>
const DateTimeInput = ({ field, value, onChange, id, disabled }: FieldInputProps) => {
  const timezone = field.date?.timezone || 'UTC'
  const [local, setLocal] = useState(typeof value === 'string' && Number.isFinite(Date.parse(value)) ? zonedParts(new Date(value), timezone) : '')
  const [error, setError] = useState(''), [fold, setFold] = useState<'earlier' | 'later' | 'reject'>('reject')
  const apply = (wall: string, choice: typeof fold) => {
    setLocal(wall); setFold(choice)
    try { onChange(wall ? wallTimeToInstant(wall, timezone, choice) : null); setError('') }
    catch (error) { onChange(null); setError((error as Error).message) }
  }
  return <><input id={id} type="datetime-local" disabled={disabled} value={local} onChange={e => apply(e.target.value, fold)} /><small>Timezone: {timezone}</small><label>When clocks repeat a time<select disabled={disabled} value={fold} onChange={e => apply(local, e.target.value as typeof fold)}><option value="reject">Ask me to choose</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label>{error && <p role="alert">{error}</p>}</>
}
const StructuredInput = ({ field, value, onChange, id, disabled }: FieldInputProps) => {
  const keys = field.kind === 'name' ? ['first', 'last'] : field.kind === 'dateRange' ? ['start', 'end'] : ['line1', 'line2', 'city', 'region', 'postalCode', 'country']
  const values = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return <div className="forms-columns">{keys.map((key, i) => <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input id={i === 0 ? id : `${id}-${key}`} disabled={disabled} type={field.kind === 'dateRange' ? 'date' : 'text'} value={String(values[key] || '')} onChange={e => onChange({ ...values, [key]: e.target.value })} /></label>)}</div>
}
const ChoiceInput = ({ field, value, onChange, id, disabled, describedBy }: FieldInputProps) => {
  const [search, setSearch] = useState('')
  const options = field.options || [], many = field.kind === 'multiSelect', selected = Array.isArray(value) ? value : []
  if (['select', 'searchSelect'].includes(field.kind)) return <>
    {field.kind === 'searchSelect' && <input aria-label={`Search ${field.label} options`} type="search" value={search} disabled={disabled} onChange={e => setSearch(e.target.value)} />}
    <select id={id} disabled={disabled} aria-describedby={describedBy} value={String(value || '')} onChange={e => onChange(e.target.value)}><option value="">Choose…</option>{options.filter(o => o.id === value || o.label.toLowerCase().includes(search.toLowerCase())).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
  </>
  return <div id={id} role="group" aria-label={field.label} className="forms-choices">{options.map(option => <label key={option.id} className="forms-check">
    {field.kind === 'imageChoice' && option.image && /^https?:\/\//.test(option.image) && <img src={option.image} alt="" width={100} height={70} loading="lazy" />}
    <input type={many ? 'checkbox' : 'radio'} name={id} disabled={disabled} checked={many ? selected.includes(option.id) : value === option.id} onChange={() => onChange(many ? selected.includes(option.id) ? selected.filter(v => v !== option.id) : [...selected, option.id] : option.id)} />{option.label}
  </label>)}</div>
}
const ScaleInput = ({ field, value, onChange, id, disabled }: FieldInputProps) => {
  const start = field.kind === 'nps' ? 0 : field.min ?? 1, end = Math.min(field.max ?? (field.kind === 'nps' ? 10 : 5), 20)
  return <div id={id} role="group" aria-label={field.label} className="forms-scale">{Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i).map(n => <button type="button" key={n} disabled={disabled} aria-pressed={n === value} onClick={() => onChange(n)}>{n}</button>)}</div>
}
const MatrixInput = ({ field, value, onChange, id, disabled }: FieldInputProps) => {
  const values = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return <div id={id} className="forms-matrix">{field.rows?.map(row => <fieldset key={row.id}><legend>{row.label}</legend>{field.options?.map(option => <label key={option.id} className="forms-check"><input type="radio" name={`${id}-${row.id}`} disabled={disabled} checked={values[row.id] === option.id} onChange={() => onChange({ ...values, [row.id]: option.id })} />{option.label}</label>)}</fieldset>)}</div>
}
const UploadInput = ({ field, value, onChange, id, disabled, onUpload }: FieldInputProps) => {
  const [progress, setProgress] = useState<number>(), [error, setError] = useState('')
  const [files, setFiles] = useState<Record<string, UploadResult>>({})
  const references = Array.isArray(value) ? value.map(String) : []
  return <div><input id={id} type="file" disabled={disabled || progress !== undefined || !onUpload} multiple={(field.files?.maxCount || 1) > 1} accept={field.files?.mimeTypes.join(',')} onChange={async e => {
    if (!onUpload) return
    const chosen = Array.from(e.target.files || [])
    if (references.length + chosen.length > (field.files?.maxCount || 1)) { setError('Too many files. Remove a file first.'); return }
    setError(''); const next = [...references]
    try { for (const file of chosen) {
      if (file.size > (field.files?.maxBytes || 10 * 1024 * 1024)) throw new Error('The file exceeds the allowed size.')
      setProgress(0); const uploaded = await onUpload(file, field, setProgress)
      next.push(uploaded.id); setFiles(old => ({ ...old, [uploaded.id]: uploaded })); onChange([...next])
    } } catch (error) { setError((error as Error).message) } finally { setProgress(undefined); e.target.value = '' }
  }} />{!onUpload && <p>Uploads are unavailable in this preview.</p>}{progress !== undefined && <progress max={100} value={progress} aria-label="Upload progress" />}{error && <p role="alert">{error}</p>}
    <ul>{references.map(ref => <li key={ref}>{files[ref]?.name || 'Saved attachment'} <small>{files[ref]?.status || 'Previously uploaded'}</small> <button type="button" disabled={disabled} onClick={() => onChange(references.filter(v => v !== ref))}>Remove {files[ref]?.name || 'attachment'}</button></li>)}</ul>
  </div>
}
const SignatureInput = ({ value, onChange, id, disabled }: FieldInputProps) => {
  const canvas = useRef<HTMLCanvasElement>(null), drawing = useRef(false)
  const values = value && typeof value === 'object' && !Array.isArray(value) ? value : { mode: 'typed' }
  const strokes = useMemo(() => (Array.isArray(values.strokes) ? values.strokes : []) as number[][][], [values.strokes])
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return
    ctx.clearRect(0, 0, 500, 160); ctx.strokeStyle = '#171717'; ctx.lineWidth = 2
    for (const stroke of strokes) { ctx.beginPath(); stroke.forEach(([x, y], i) => i ? ctx.lineTo(x * 500, y * 160) : ctx.moveTo(x * 500, y * 160)); ctx.stroke() }
  }, [strokes])
  return <div><label>Signature method<select id={`${id}-mode`} disabled={disabled} value={String(values.mode)} onChange={e => onChange({ mode: e.target.value })}><option value="typed">Type my name</option><option value="drawn">Draw signature</option></select></label>
    {values.mode === 'typed' ? <input id={id} aria-label="Full name as signature" disabled={disabled} value={String(values.name || '')} onChange={e => onChange({ mode: 'typed', name: e.target.value })} /> : <><canvas ref={canvas} id={id} width={500} height={160} aria-label="Draw signature; choose Type my name for keyboard entry" className="forms-signature" onPointerDown={e => { if (disabled) return; drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); onChange({ mode: 'drawn', strokes: [...strokes, [[(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]]] }) }} onPointerMove={e => { if (!drawing.current || disabled) return; const r = e.currentTarget.getBoundingClientRect(); const point = [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; onChange({ mode: 'drawn', strokes: [...strokes.slice(0, -1), [...(strokes.at(-1) || []), point]] }) }} onPointerUp={() => { drawing.current = false }} onPointerCancel={() => { drawing.current = false }} /><button type="button" disabled={disabled} onClick={() => onChange({ mode: 'drawn', strokes: [] })}>Clear signature</button></>}
  </div>
}
for (const kind of ['text', 'textarea', 'email', 'phone', 'url', 'number', 'currency', 'slider', 'date', 'time']) registerFieldRenderer(kind, TextInput)
registerFieldRenderer('datetime', DateTimeInput)
for (const kind of ['checkbox', 'consent', 'terms']) registerFieldRenderer(kind, CheckboxInput)
for (const kind of ['name', 'address']) registerFieldRenderer(kind, ContactInput)
registerFieldRenderer('dateRange', StructuredInput)
fieldRenderers.set('phone', props => props.field.contact ? <ContactInput {...props} /> : <TextInput {...props} />)
for (const kind of ['select', 'searchSelect', 'radio', 'multiSelect', 'imageChoice']) registerFieldRenderer(kind, ChoiceInput)
for (const kind of ['rating', 'nps']) registerFieldRenderer(kind, ScaleInput)
registerFieldRenderer('likert', MatrixInput); registerFieldRenderer('ranking', RankingInput)
registerFieldRenderer('upload', UploadInput); registerFieldRenderer('signature', SignatureInput)

export function FormRenderer({ definition, initialAnswers = {}, preview, disabled, onChange, onSubmit, onSave, onUpload, onEvent, onAnalyticsConsent, showLogic, booking }: FormRendererProps) {
  const [raw, setRaw] = useState<Answers>(initialAnswers), [step, setStep] = useState(0)
  const [errors, setErrors] = useState<FormIssue[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [consent, setConsent] = useState(false), [review, setReview] = useState(false)
  const uid = useId(), root = useRef<HTMLDivElement>(null), summary = useRef<HTMLDivElement>(null), [started, setStarted] = useState(false)
  const enteredAt = useRef(0)
  const measuring = definition.access.analytics && (!definition.access.analyticsConsent || consent) && !preview
  useEffect(() => { onAnalyticsConsent?.(consent) }, [consent, onAnalyticsConsent])
  useEffect(() => {
    if (measuring) { onEvent?.('view', { consent }); if (started) onEvent?.('start', { consent }) }
  }, [measuring, consent, started, onEvent])
  const evaluation = useMemo(() => evaluateForm(definition, raw), [definition, raw])
  const report = (type: Parameters<NonNullable<typeof onEvent>>[0], data = {}) => {
    if (measuring) onEvent?.(type, { ...data, consent })
  }
  const change = (id: string, value: FormValue) => {
    const next = { ...raw, [id]: value }; setRaw(next); onChange?.(next)
    setErrors(old => old.filter(error => error.field !== id))
    if (!started) setStarted(true)
  }
  const active = definition.fields.filter(f => evaluation.states[f.id]?.visible && f.kind !== 'hidden')
  const groups = definition.mode === 'conversational' ? active.map(f => ({ id: f.id, label: f.label, fields: [f] })) :
    active.some(f => f.kind === 'step') ? active.map(f => ({ id: f.id, label: f.label, fields: f.kind === 'step' ? f.children || [] : [f] })) : [{ id: 'form', label: 'Your answers', fields: active }]
  const current = Math.min(step, Math.max(0, groups.length - 1)), group = groups[current]
  const groupID = definition.mode === 'standard' ? 'form' : group?.id
  useEffect(() => {
    enteredAt.current = measurementTime()
    if (!measuring || !groupID) return
    onEvent?.('step', { step: groupID, consent })
    const leave = () => onEvent?.('step-exit', { step: groupID, durationMs: Math.min(86400000, measurementTime() - enteredAt.current), consent })
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [groupID, measuring, onEvent, consent])
  const presentErrors = (issues: FormIssue[], measured = false) => { setErrors(issues); if (!measured) report('error', { fields: [...new Set(issues.map(e => e.field).filter(Boolean))] }); requestAnimationFrame(() => summary.current?.focus()) }
  const navigate = (index: number) => { report('step-exit', { step: groupID, durationMs: Math.min(86400000, measurementTime() - enteredAt.current) }); setStep(index); setReview(false); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('.forms-step-heading')?.focus()) }
  const next = () => {
    const scope = new Set(flattenFields(group?.fields || []).map(f => f.id))
    const issues = validateAnswers(definition, raw).issues.filter(issue => scope.has(issue.field || ''))
    if (issues.length) { presentErrors(issues); return }
    setErrors([])
    if (evaluation.route) { const index = groups.findIndex(g => g.id === evaluation.route); if (index > current) { navigate(index); return } }
    if (current < groups.length - 1) navigate(current + 1); else setReview(true)
  }
  const submit = async () => {
    const result = validateAnswers(definition, raw)
    if (result.issues.length) { presentErrors(result.issues); return }
    setBusy(true); setMessage('')
    try {
      const response = onSubmit ? await onSubmit(result.answers) : { message: preview ? 'Preview validated. Nothing was submitted.' : 'Submission is not configured.' }
      if (response.errors?.length) presentErrors(response.errors, response.analyticsRecorded)
      else { setErrors([]); setMessage(response.message || evaluation.confirmation); if (onSubmit) report('accepted') }
      if (response.redirect?.startsWith('/') && !response.redirect.startsWith('//')) window.location.assign(response.redirect)
    } catch (error) { setMessage((error as Error).message || 'Could not submit. Your answers are still here; please retry.') } finally { setBusy(false) }
  }
  const reviewAnswers = <dl className="forms-review">{flattenFields(definition.fields).filter(f => !formFields.get(f.kind)?.structural && f.kind !== 'hidden' && evaluation.states[f.id]?.visible && !isEmpty(evaluation.answers[f.id])).map(f => <React.Fragment key={f.id}><dt>{f.label}</dt><dd>{formFields.get(f.kind)?.format(evaluation.answers[f.id], f)}</dd></React.Fragment>)}</dl>
  const render = (field: FormField, parent?: { values: Answers; change: (id: string, value: FormValue) => void; prefix: string }): React.ReactNode => {
    const state = parent ? { visible: true, enabled: true, required: !!field.required } : evaluation.states[field.id]
    if (!state?.visible || field.kind === 'hidden') return null
    const value = parent ? parent.values[field.id] : evaluation.answers[field.id]
    const update = (value: FormValue) => parent ? parent.change(field.id, value) : change(field.id, value)
    const id = `${uid}-${parent?.prefix || ''}${field.id}`, issues = errors.filter(e => e.path === (parent ? `${parent.prefix}${field.id}` : field.id))
    const Input = fieldRenderers.get(field.kind), off = disabled || busy || !state.enabled
    const title = <label htmlFor={id}>{field.label}{state.required && <span aria-label="required"> *</span>}</label>
    let content: React.ReactNode
    if (field.kind === 'heading') content = <h3>{field.label}</h3>
    else if (field.kind === 'content') content = <p>{field.help || field.label}</p>
    else if (field.kind === 'divider') content = <hr />
    else if (field.kind === 'review') content = reviewAnswers
    else if (field.layout?.kind === 'columns') content = <FormColumns field={field} preview={preview} disabled={off}>{field.children?.map(f => render(f, parent))}</FormColumns>
    else if (field.layout?.kind === 'column') content = <fieldset className="forms-layout-column" disabled={off} aria-label={field.label}><div className="forms-grid">{field.children?.map(f => render(f, parent))}</div></fieldset>
    else if (['section', 'row', 'step'].includes(field.kind)) content = <fieldset disabled={off}><legend>{field.label}</legend><div className="forms-grid">{field.children?.map(f => render(f, parent))}</div></fieldset>
    else if (field.kind === 'datetime' && field.date?.resource) content = <>{title}<BookingInput field={field} path={parent ? `${parent.prefix}${field.id}` : field.id} id={id} value={typeof value === 'string' ? value : undefined} disabled={off} adapter={preview ? undefined : booking} onChange={update} /></>
    else if (field.kind === 'calculated') content = <>{title}<output id={id}>{field.currency ? new Intl.NumberFormat(definition.locale, { style: 'currency', currency: field.currency }).format(Number(value || 0)) : String(value ?? '')}</output></>
    else if (field.kind === 'repeater') {
      const rows = Array.isArray(value) ? value as Answers[] : []
      content = <fieldset disabled={off}><legend>{field.label}</legend>{rows.map((row, index) => <fieldset key={index}><legend>{field.label} {index + 1}</legend>{field.children?.map(f => render(f, { values: row, prefix: `${field.id}.${index}.`, change: (key, next) => update(rows.map((r, i) => i === index ? { ...r, [key]: next } : r)) }))}<button type="button" disabled={off || rows.length <= (field.min || 0)} onClick={() => update(rows.filter((_, i) => i !== index))}>Remove item {index + 1}</button></fieldset>)}<button type="button" disabled={off || rows.length >= (field.max ?? 50)} onClick={() => update([...rows, {}])}>Add {field.label}</button></fieldset>
    } else content = <>{title}{Input ? <Input field={field} value={value} onChange={update} id={id} disabled={off} invalid={issues.length > 0} describedBy={`${id}-help ${id}-errors`} onUpload={onUpload} /> : <p role="alert">This field type is unavailable.</p>}</>
    return <div key={field.id} className={`forms-field forms-style-${state.style || 'normal'}`} style={{ ...widthStyle(field.layout?.kind === 'columns' && field.layout.width === 'full' ? 1 : widthFraction(field)), gridColumn: `span ${field.layout?.kind === 'columns' && field.layout.width === 'full' ? 12 : field.width || 12}` }}>{content}{field.help && field.kind !== 'content' && <small id={`${id}-help`}>{field.help}</small>}<div id={`${id}-errors`}>{issues.map((error, i) => <p key={i} className="forms-error">{error.message}</p>)}</div></div>
  }
  const theme = definition.theme
  return <div ref={root} className={`forms-runtime forms-size-${theme.size}`} lang={definition.locale} dir={definition.direction} style={{ '--forms-primary': theme.primary, '--forms-background': theme.background, '--forms-text': theme.text, '--forms-border': theme.border, '--forms-error': theme.error, '--forms-radius': `${theme.radius}px`, '--forms-spacing': `${theme.spacing}px`, fontFamily: theme.font } as React.CSSProperties}>
    {errors.length > 0 && <div ref={summary} tabIndex={-1} role="alert" className="forms-error-summary"><h3>Please check your answers</h3>{errors.map((error, i) => <p key={i}><button type="button" onClick={() => { const index = groups.findIndex(g => flattenFields(g.fields).some(f => f.id === error.field)); if (index >= 0) navigate(index); requestAnimationFrame(() => document.getElementById(`${uid}-${error.path}`)?.focus()) }}>{error.message}</button></p>)}</div>}
    {definition.access.analytics && definition.access.analyticsConsent && !preview && <label className="forms-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Allow anonymous form usage measurements. Answers are not included.</label>}
    {definition.mode !== 'standard' && <><p aria-live="polite">{review ? 'Review your answers' : `Step ${current + 1} of ${groups.length}`}</p><progress max={groups.length} value={review ? groups.length : current + 1} aria-label="Form progress" /><h2 className="forms-step-heading" tabIndex={-1}>{review ? 'Review' : group?.label}</h2></>}
    {review ? reviewAnswers : <div className="forms-grid">{(definition.mode === 'standard' ? active : group?.fields || []).map(f => render(f))}</div>}
    <div className="forms-actions">{definition.mode !== 'standard' && (current > 0 || review) && <button type="button" disabled={busy} onClick={() => review ? setReview(false) : navigate(current - 1)}>Back</button>}
      {definition.access.saveProgress && onSave && <button type="button" disabled={busy || disabled} onClick={async () => { setBusy(true); try { setMessage((await onSave(raw)).message) } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }}>Save progress</button>}
      {definition.mode !== 'standard' && !review ? <button type="button" className="forms-primary" disabled={disabled || busy} onClick={next}>Continue</button> : <button type="button" className="forms-primary" disabled={disabled || busy} onClick={submit}>{busy ? 'Working…' : theme.buttonLabel}</button>}
    </div><p role="status">{message}</p>
    {showLogic && <aside className="forms-logic"><h3>Logic inspector</h3><p>{evaluation.matchedRules.length ? 'Matched rules:' : 'No rules matched.'}</p><ul>{definition.rules.map(rule => <li key={rule.id}>{evaluation.matchedRules.includes(rule.id) ? 'Matched' : 'Not matched'}: {rule.name}</li>)}</ul><p>{evaluation.issues.map(issue => issue.message).join(' ')}</p></aside>}
  </div>
}
