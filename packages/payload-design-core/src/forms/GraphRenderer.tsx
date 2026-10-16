'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FormRenderer, type FormRendererProps } from './FormRenderer'
import { canvasButtons, graphScope, graphAnswers, runGraph, type GraphEvent } from './graph'
import { evaluateForm, validateAnswers } from './engine'
import { flattenFields, type Answers, type FormIssue } from './model'

export function GraphRenderer(props: FormRendererProps) {
  const { definition, preview, disabled, onGraphRun } = props
  const [answers, setAnswers] = useState<Answers>(() => evaluateForm({ ...definition, graph: undefined }, props.initialAnswers || {}).answers)
  const [events, setEvents] = useState<GraphEvent[]>([]), [errors, setErrors] = useState<FormIssue[]>([])
  const [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false), [notice, setNotice] = useState('')
  const submitted = useRef(false), heading = useRef<HTMLHeadingElement>(null)
  const run = useMemo(() => runGraph(definition, answers, events, true), [definition, answers, events])
  const node = run.node, canvas = definition.fields.find(f => f.id === node?.canvas)
  useEffect(() => { onGraphRun?.(run) }, [run, onGraphRun])
  useEffect(() => { heading.current?.focus() }, [node?.id])
  const advance = (output: string) => { if (node) { setErrors([]); setEvents(old => [...old, { node: node.id, output }]) } }
  const back = () => {
    if (accepted) return
    let index = events.length - 1
    while (index >= 0 && definition.graph?.nodes.find(n => n.id === events[index].node)?.kind !== 'canvas') index--
    if (index >= 0) { setEvents(events.slice(0, index)); setErrors([]); setNotice('') }
  }
  const validate = (currentOnly: boolean) => {
    const scoped = graphScope(definition, run)
    const result = validateAnswers(scoped, graphAnswers(definition, scoped, run.answers))
    if (currentOnly) { const ids = new Set(flattenFields(canvas ? [canvas] : []).map(f => f.id)); result.issues = result.issues.filter(issue => ids.has(issue.field || '')) }
    setErrors(result.issues)
    return result
  }
  const submit = async () => {
    if (submitted.current || busy) return
    const result = validate(false)
    if (result.issues.length) return
    submitted.current = true; setBusy(true)
    try {
      const response = preview ? { message: 'Preview submission validated. Nothing was saved.' } : props.onSubmit ? await props.onSubmit(run.answers, events) : { errors: [{ path: 'submit', message: 'Submission is not configured.' }] }
      if (response.errors?.length) { setErrors(response.errors); submitted.current = false; if (definition.graph?.edges.some(e => e.source === node?.id && e.output === 'failure')) advance('failure') }
      else { setAccepted(true); setNotice(response.message || 'Entry accepted.'); advance('success'); if (!definition.graph?.edges.some(e => e.source === node?.id && e.output === 'success') && response.redirect?.startsWith('/') && !response.redirect.startsWith('//')) window.location.assign(response.redirect) }
    } catch (e) { submitted.current = false; setNotice((e as Error).message); if (definition.graph?.edges.some(edge => edge.source === node?.id && edge.output === 'failure')) advance('failure') }
    finally { setBusy(false) }
  }
  // Entering Submit is an explicit consequence of a connected user button, never a render-time side effect.
  useEffect(() => { if (node?.kind === 'submit' && events.length && !run.error && !submitted.current && !errors.length) void submit() }, [node?.id, events.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const currentDefinition = { ...graphScope(definition, run), access: { ...definition.access, saveProgress: false } }
  const names = new Map(flattenFields(definition.fields).map(f => [f.id, f.label]))
  return <section className="forms-graph-runtime" aria-label="Connected form">
    <h2 ref={heading} tabIndex={-1}>{canvas?.label || node?.name || 'Form flow'}</h2>
    {run.error && <p role="alert">{run.error}</p>}
    {errors.length > 0 && <div role="alert"><h3>Please check your answers</h3>{errors.map((e, i) => <p key={i}>{names.get(e.field || '')}: {e.message}</p>)}</div>}
    {node?.kind === 'canvas' && <FormRenderer key={`${node.id}:${events.length}`} {...props} definition={currentDefinition} initialAnswers={run.answers} renderFieldIDs={canvas ? [canvas.id] : []} hideActions onGraphRun={undefined} onChange={next => { const merged = { ...answers, ...next }; setAnswers(merged); props.onChange?.(merged); setErrors([]) }} />}
    {node?.kind === 'canvas' && <div className="forms-actions">{canvasButtons(definition, canvas?.id).map(button => <button type="button" key={button.id} disabled={disabled || busy || !!run.error || button.event === 'back' && (accepted || !events.some(e => definition.graph?.nodes.find(n => n.id === e.node)?.kind === 'canvas'))} onClick={() => { if (button.event === 'back') back(); else if (!validate(true).issues.length) advance(button.id) }}>{button.label}</button>)}</div>}
    {node?.kind === 'message' && <><p>{node.message}</p><button type="button" disabled={disabled} onClick={() => advance('next')}>Continue</button></>}
    {node?.kind === 'end' && <p role="status">{node.message}</p>}
    {node?.kind === 'submit' && <><button type="button" disabled={busy || accepted || disabled} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Retry submission'}</button><button type="button" disabled={busy || accepted} onClick={back}>Back</button></>}
    {props.onSave && !accepted && <button type="button" onClick={async () => { try { setNotice((await props.onSave!(answers)).message) } catch (e) { setNotice((e as Error).message) } }}>Save progress</button>}
    {notice && <p role="status">{notice}</p>}
    {run.log.some(line => line.startsWith('Simulated')) && <aside aria-label="Simulated actions"><p>Experimental actions are simulated. No email, CMS write, or HTTP request was performed by these blocks.</p></aside>}
  </section>
}
