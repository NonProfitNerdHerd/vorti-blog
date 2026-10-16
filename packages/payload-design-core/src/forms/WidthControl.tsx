'use client'
import React, { useRef, useState } from 'react'
import { MoveHorizontal } from 'lucide-react'

export function WidthControl({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<{ value: number; text: string }>(), [error, setError] = useState('')
  const text = draft?.value === value ? draft.text : Math.round(value * 100) + '%'
  const setText = (text: string) => setDraft({ value, text })
  const apply = () => { if (disabled) return; if (text === Math.round(value * 100) + '%') { setError(''); return } const raw = Number(text.replace('%', '').trim()), next = text.includes('%') || raw > 1 ? raw / 100 : raw; if (!Number.isFinite(next) || next < .1 || next > 1) { setError('Enter .1–1 or 10%–100%.'); return } setError(''); if (Math.round(next * 100) / 100 !== value) onChange(Math.round(next * 100) / 100) }
  return <div><label>Width<input aria-label="Width" disabled={disabled} value={text} onChange={event => setText(event.target.value)} onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply() } }} /></label><label>Width preset<select aria-label="Width preset" disabled={disabled} value={[1, .75, .67, .5, .33, .25].includes(value) ? value : ''} onChange={event => { if (event.target.value) onChange(Number(event.target.value)) }}><option value="">Custom</option>{[[1, 'Full'], [.75, 'Three quarters'], [.67, 'Two thirds'], [.5, 'Half'], [.33, 'One third'], [.25, 'One quarter']].map(([width, label]) => <option key={width} value={width}>{label}</option>)}</select></label>{error && <p role="alert">{error}</p>}</div>
}
export function ResizeHandle({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  const [pending, setPending] = useState<number>(), drag = useRef<{ x: number; width: number; initial: number; element: HTMLElement } | null>(null)
  const current = pending ?? value
  const preview = (next: number, element: HTMLElement) => { const bounded = Math.max(.1, Math.min(1, Math.round(next * 100) / 100)); element.style.setProperty('--part-width', String(bounded)); setPending(bounded) }
  const finish = (commit: boolean) => { const state = drag.current; if (state) { state.element.style.setProperty('--part-width', String(state.initial)); if (commit && pending !== undefined && pending !== state.initial) onChange(pending) } drag.current = null; setPending(undefined) }
  return <button type="button" className="forms-resize-handle" role="slider" aria-label={`Resize ${label}`} aria-valuemin={10} aria-valuemax={100} aria-valuenow={Math.round(current * 100)} aria-valuetext={`${Math.round(current * 100)} percent`} title="Drag to resize. Arrow keys adjust; Enter finishes; Escape cancels." onClick={event => event.stopPropagation()} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); const element = event.currentTarget.closest<HTMLElement>('[data-width-part]')!; drag.current = { x: event.clientX, width: element.parentElement!.getBoundingClientRect().width, initial: value, element }; setPending(value); event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { const state = drag.current; if (state && event.buttons) preview(state.initial + (event.clientX - state.x) / state.width, state.element) }} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false) }
    else if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); finish(true) }
    else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); const element = event.currentTarget.closest<HTMLElement>('[data-width-part]')!; drag.current ||= { x: 0, width: 0, initial: value, element }; preview(event.key === 'Home' ? .1 : event.key === 'End' ? 1 : current + (event.key === 'ArrowRight' ? .01 : -.01), element) }
  }} onBlur={() => finish(true)}><MoveHorizontal size={14} /><span>{Math.round(current * 100)}%</span></button>
}
