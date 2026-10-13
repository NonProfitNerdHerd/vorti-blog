import type { Endpoint } from 'payload'
import { flattenFields, type FormDefinition } from '@design-system/payload-design-core/forms'
import { canForm, type FormsUser } from './access'
import type { FormPlatform } from './platform'
import { FormHTTPError, hashToken } from './security'

export interface AnalyticsEvent { kind: 'view' | 'start' | 'step' | 'step-exit' | 'error'; eventID: string; step?: string; fields: string[]; durationMs?: number }
export function analyticsEvent(definition: FormDefinition, body: Record<string, unknown>): AnalyticsEvent | null {
  if (!definition.access.analytics || (definition.access.analyticsConsent && body.consent !== true)) return null
  if (!['view', 'start', 'step', 'step-exit', 'error'].includes(String(body.kind))) throw new FormHTTPError('Unsupported analytics event.')
  if (typeof body.eventID !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.eventID)) throw new FormHTTPError('Invalid analytics event identifier.')
  const fields = new Set(flattenFields(definition.fields).map(field => field.id))
  const steps = new Set(['form', ...definition.fields.map(field => field.id)])
  if (body.step !== undefined && (typeof body.step !== 'string' || !steps.has(body.step))) throw new FormHTTPError('Unknown analytics step.')
  if (body.fields !== undefined && (!Array.isArray(body.fields) || body.fields.length > 100 || body.fields.some(field => typeof field !== 'string' || !fields.has(field)))) throw new FormHTTPError('Unknown analytics field.')
  if (body.durationMs !== undefined && (!Number.isInteger(body.durationMs) || Number(body.durationMs) < 0 || Number(body.durationMs) > 86400000)) throw new FormHTTPError('Invalid analytics duration.')
  return { kind: body.kind as AnalyticsEvent['kind'], eventID: body.eventID, step: body.step as string | undefined,
    fields: body.kind === 'error' ? [...new Set((body.fields || []) as string[])] : [], durationMs: body.durationMs as number | undefined }
}

export async function recordAnalytics(db: D1Database, site: string, formID: string | number, revision: string, sessionHash: string, event: AnalyticsEvent, now = new Date().toISOString()) {
  const eventID = await hashToken(`analytics:${site}:${revision}:${sessionHash}:${['view', 'start'].includes(event.kind) ? event.kind : event.eventID}`)
  await db.prepare('INSERT OR IGNORE INTO form_analytics (label, site, form_i_d, revision, event_i_d, session_hash, kind, step, duration_ms, field_i_ds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(event.kind, site, String(formID), revision, eventID, sessionHash, event.kind, event.step || null, event.durationMs ?? null, JSON.stringify(event.fields), now, now).run()
}

export function formAnalyticsEndpoints(platform: FormPlatform): Endpoint[] {
  return [{ path: '/forms-analytics/:id', method: 'get', handler: async req => {
    if (!req.user) return Response.json({ message: 'Entry access is required.' }, { status: 403 })
    const form = await platform.db.prepare('SELECT id, site FROM forms WHERE id=?').bind(String(req.routeParams?.id || '')).first<{ id: number; site: string }>()
    if (!form || !canForm(req.user as FormsUser, 'entries', form.site)) return Response.json({ message: 'Form not found.' }, { status: 404 })
    const url = new URL(req.url!), end = new Date(url.searchParams.get('to') || Date.now()), start = new Date(url.searchParams.get('from') || Date.now() - 30 * 86400000)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 366 * 86400000) return Response.json({ message: 'Choose a date range of up to 366 days.' }, { status: 400 })
    const where = 'site=? AND form_i_d=? AND created_at>=? AND created_at<?', values = [form.site, String(form.id), start.toISOString(), end.toISOString()]
    const counts = (await platform.db.prepare(`SELECT kind, COUNT(*) AS events, COUNT(DISTINCT session_hash) AS sessions, AVG(duration_ms) AS average_ms FROM form_analytics WHERE ${where} GROUP BY kind`).bind(...values).all()).results
    const steps = (await platform.db.prepare(`SELECT step, kind, COUNT(*) AS events, COUNT(DISTINCT session_hash) AS sessions FROM form_analytics WHERE ${where} AND step IS NOT NULL GROUP BY step,kind`).bind(...values).all()).results
    const failures = (await platform.db.prepare(`SELECT value AS field, COUNT(*) AS events FROM form_analytics, json_each(field_i_ds) WHERE ${where} AND kind='error' GROUP BY value`).bind(...values).all()).results
    const views = Number(counts.find(row => row.kind === 'view')?.sessions || 0), starts = Number(counts.find(row => row.kind === 'start')?.sessions || 0), completed = Number(counts.find(row => row.kind === 'accepted')?.sessions || 0)
    const cohort = await platform.db.prepare(`SELECT COUNT(DISTINCT s.session_hash) AS completed FROM form_analytics s WHERE s.site=? AND s.form_i_d=? AND s.created_at>=? AND s.created_at<? AND s.kind='start' AND EXISTS (SELECT 1 FROM form_analytics a WHERE a.site=s.site AND a.form_i_d=s.form_i_d AND a.revision=s.revision AND a.session_hash=s.session_hash AND a.kind='accepted' AND a.created_at>=? AND a.created_at<?)`).bind(...values, start.toISOString(), end.toISOString()).first<{ completed: number }>()
    const completedStarts = Number(cohort?.completed || 0)
    return Response.json({ from: start.toISOString(), to: end.toISOString(), views, starts, completed, completionRate: starts ? completedStarts / starts : null,
      estimatedAbandonments: starts - completedStarts, averageCompletionMs: counts.find(row => row.kind === 'accepted')?.average_ms ?? null, counts, steps, failures }, { headers: { 'Cache-Control': 'private, no-store' } })
  } }]
}
