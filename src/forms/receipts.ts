import type { Endpoint } from 'payload'
import { receiptDocument, type Answers, type FormField } from '@design-system/payload-design-core/forms'
import { canForm, type FormsUser } from './access'
import type { FormPlatform } from './platform'
import { entrySchema, visibleAnswers } from './redaction'

export interface ReceiptEntry { id: number; site: string; revision: string; created_at: string; schema_snapshot: string; answers: string }
export function receiptResponse(entry: ReceiptEntry, sensitive: boolean): Response {
  const snapshot = JSON.parse(entry.schema_snapshot) as { title: string; fields: FormField[] }
  return new Response(receiptDocument({ title: snapshot.title, fields: entrySchema(snapshot.fields, sensitive), answers: visibleAnswers(snapshot.fields, JSON.parse(entry.answers) as Answers, sensitive), entryID: String(entry.id), revision: entry.revision, submittedAt: entry.created_at }), { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  } })
}
export function formReceiptEndpoints(platform: FormPlatform): Endpoint[] {
  return [{ path: '/forms-receipts/:id', method: 'get', handler: async req => {
    if (!req.user) return Response.json({ message: 'Entry access is required.' }, { status: 403 })
    const entry = await platform.db.prepare('SELECT id,site,revision,created_at,schema_snapshot,answers FROM form_submissions WHERE id=?').bind(String(req.routeParams?.id || '')).first<ReceiptEntry>()
    if (!entry || !canForm(req.user as FormsUser, 'entries', entry.site)) return Response.json({ message: 'Entry not found.' }, { status: 404 })
    return receiptResponse(entry, canForm(req.user as FormsUser, 'sensitive', entry.site))
  } }]
}
