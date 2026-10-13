import type { Endpoint, Payload } from 'payload'
import { flattenFields, type Answers, type FormField } from '@design-system/payload-design-core/forms'
import { canForm, FORM_SITE, type FormsUser } from './access'
import { ActionHandlers, FormOutbox, PermanentActionError, UnconfiguredAction, type OutboxJob } from './outbox'
import type { FormPlatform } from './platform'
import { constantEqual, readBoundedJSON } from './security'
import { deliverWebhook } from './webhook'
import { maintainForms } from './maintenance'
import { generateExport } from './exports'
import { openMessage, sealMessage } from './private-message'
import { registerCMSHandlers } from './cms-actions'

export function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}
export function mergeText(template: string, answers: Answers, summary: string): string {
  return template.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_, id: string) => {
    const value = id === 'summary' ? summary : answers[id]
    return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}
interface Entry { answers: string; schema_snapshot: string; idempotency_key: string }
interface Integration { provider: string; credential_name: string; settings: string; enabled: number }
export function createActionHandlers(platform: FormPlatform, payload: Payload): ActionHandlers {
  const handlers = new ActionHandlers()
  registerCMSHandlers(handlers, platform, payload)
  handlers.register('resume-email', async ({ job, action }) => {
    const draft = await platform.db.prepare('SELECT id FROM form_drafts WHERE id=? AND site=? AND revision=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(Number(action.config.draftID), job.site, job.revision, String(action.config.tokenHash || ''), new Date().toISOString()).first()
    if (!draft) throw new PermanentActionError('The saved draft expired, was revoked, or its link was replaced. Request a new email.')
    const message = JSON.parse(await openMessage(payload.secret, `${job.site}:${job.event_i_d}`, String(action.config.envelope || ''))) as { email: string; url: string; title: string }
    const subject = `Resume ${message.title}`.replace(/[\r\n]/g, ' ').slice(0, 200)
    const text = `Continue your saved form using this private link:\n${message.url}\n\nDo not share this link. It provides access to your saved answers. Account drafts also require sign-in.`
    if (platform.local) {
      const envelope = await sealMessage(payload.secret, `${job.site}:${job.event_i_d}:delivery`, text)
      await platform.db.prepare('INSERT OR IGNORE INTO form_deliveries(label,site,kind,event_i_d,recipient,subject,body,headers) VALUES(?,?,?,?,?,?,?,?)').bind('Local capture · resume email', job.site, 'resume-email', job.event_i_d, message.email, subject, 'Private resume link encrypted. Use the protected message viewer.', JSON.stringify({ envelope, draftID: action.config.draftID, tokenHash: action.config.tokenHash })).run()
      return
    }
    if (payload.email.name === 'console') throw new UnconfiguredAction('Configure a Payload email provider to deliver resume links.')
    await payload.sendEmail({ to: message.email, subject, text, html: `<pre>${escapeHTML(text)}</pre>`, messageId: `<forms-${job.event_i_d}@forms.local>` })
  })
  async function entry(job: OutboxJob) {
    const row = await platform.db.prepare('SELECT answers, schema_snapshot, idempotency_key FROM form_submissions WHERE id=? AND site=? AND revision=?').bind(job.submission_i_d, job.site, job.revision).first<Entry>()
    if (!row) throw new PermanentActionError('The original submission is unavailable.')
    const answers = JSON.parse(row.answers) as Answers, snapshot = JSON.parse(row.schema_snapshot) as { title: string; fields: FormField[] }
    const summary = flattenFields(snapshot.fields).filter(field => answers[field.id] !== undefined).map(field => `${field.label}: ${typeof answers[field.id] === 'object' ? JSON.stringify(answers[field.id]) : String(answers[field.id])}`).join('\n')
    return { answers, snapshot, summary }
  }
  async function capture(job: OutboxJob, kind: string, body: string, recipient = '', subject = '') {
    await platform.db.prepare('INSERT OR IGNORE INTO form_deliveries (label, site, kind, event_i_d, recipient, subject, body) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(`Local capture · ${kind}`, job.site, kind, job.event_i_d, recipient, subject, body).run()
  }
  async function integration(job: OutboxJob, id: unknown, provider: string) {
    if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new UnconfiguredAction('Select an administrator-configured integration.')
    const result = await platform.db.prepare('SELECT provider, credential_name, settings, enabled FROM form_integrations WHERE id=? AND site=?').bind(id, job.site).first<Integration>()
    if (!result?.enabled || result.provider !== provider) throw new UnconfiguredAction('The integration is unavailable, disabled, or belongs to another site.')
    return result
  }
  handlers.register('email', async ({ job, action }) => {
    const { answers, snapshot, summary } = await entry(job)
    const recipientTemplate = String(action.config.to || '')
    for (const match of recipientTemplate.matchAll(/\{\{([^}]+)\}\}/g)) {
      if (!flattenFields(snapshot.fields).some(field => field.id === match[1] && field.kind === 'email')) throw new PermanentActionError('Recipient merge fields must refer to an email field.')
    }
    const recipients = mergeText(recipientTemplate, answers, '').split(',').map(value => value.trim())
    if (!recipients.length || recipients.length > 20 || recipients.some(value => !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value))) throw new PermanentActionError('Configure a valid notification recipient.')
    const subject = mergeText(String(action.config.subject || ''), answers, '').replace(/[\r\n]/g, ' ').slice(0, 200)
    const text = mergeText(String(action.config.body || '{{summary}}'), answers, summary)
    if (!action.config.integration && platform.local) { await capture(job, 'email', text, recipients.join(', '), subject); return }
    if (action.config.integration && action.config.integration !== 'default') await integration(job, action.config.integration, 'payload-email')
    if (payload.email.name === 'console') throw new UnconfiguredAction('Configure a Payload email provider or choose local capture.')
    await payload.sendEmail({ to: recipients, subject, text, html: `<pre>${escapeHTML(text)}</pre>`, headers: { 'X-Form-Event': job.event_i_d }, messageId: `<forms-${job.event_i_d.replace(/[^a-zA-Z0-9-]/g, '-')}@forms.local>` })
  })
  handlers.register('localWebhook', async ({ job }) => {
    if (!platform.local) throw new UnconfiguredAction('Local webhook capture is available only in a development environment.')
    const { answers } = await entry(job)
    await capture(job, 'webhook', JSON.stringify({ version: 1, event: 'form.submitted', eventID: job.event_i_d, revision: job.revision, answers }))
  })
  handlers.register('webhook', async ({ job, action }) => {
    const connection = await integration(job, action.config.integration, 'webhook')
    const config = JSON.parse(connection.settings || '{}') as { url?: string; authorization?: string; mappings?: Record<string, string> }
    if (!/^FORM_INTEGRATION_[A-Z0-9_]+$/.test(connection.credential_name || '')) throw new UnconfiguredAction('Configure a server-side signing credential for this webhook.')
    const credential = process.env[connection.credential_name]
    if (!credential) throw new UnconfiguredAction('The webhook signing credential is not configured in this environment.')
    const { answers } = await entry(job)
    const included = String(action.config.fields || '').split(',').map(value => value.trim()).filter(Boolean)
    const selected = Object.fromEntries(Object.entries(answers).filter(([id]) => !included.length || included.includes(id)).map(([id, value]) => [config.mappings?.[id] || id, value]))
    // Authorization values are resolved from server secrets, never persisted as plain integration settings.
    const authorization = config.authorization && /^FORM_INTEGRATION_[A-Z0-9_]+$/.test(config.authorization) ? process.env[config.authorization] : undefined
    if (config.authorization && !authorization) throw new UnconfiguredAction('The webhook authorization credential is not configured.')
    await deliverWebhook({ url: config.url || '', secret: credential, authorization, eventID: job.event_i_d, body: JSON.stringify({ version: 1, event: 'form.submitted', eventID: job.event_i_d, revision: job.revision, submissionID: job.submission_i_d, answers: selected }) })
  })
  handlers.register('form-export', async ({ job, action }) => {
    const id = Number(action.config.exportID)
    if (!Number.isSafeInteger(id) || id < 1) throw new PermanentActionError('Invalid export job.')
    await generateExport(platform, payload, job.site, id)
    const result = await platform.db.prepare('SELECT status,error FROM form_exports WHERE id=? AND site=?').bind(id, job.site).first<{ status: string; error?: string }>()
    if (result?.status === 'failed') throw new PermanentActionError(result.error || 'Export generation failed. Request a new export.')
  })
  return handlers
}

/** Authenticated manual processing/recovery. Scheduled execution calls the same processor. */
export function formActionEndpoints(platform: FormPlatform): Endpoint[] {
  return [{ path: '/forms-actions/options', method: 'get', handler: async req => {
    const site = platform.resolveSite?.(req) || FORM_SITE
    if (!canForm(req.user as FormsUser, 'edit', site)) return Response.json({ message: 'Form editing access is required.' }, { status: 403 })
    const emailConfigured = req.payload.email.name !== 'console'
    const result = await platform.db.prepare('SELECT id,label,provider,enabled FROM form_integrations WHERE site=? AND enabled=1 ORDER BY label,id LIMIT 100').bind(site).all<{ id: number; label: string; provider: string; enabled: number }>()
    return Response.json({ local: !!platform.local, emailConfigured, integrations: [
      { id: 'default', label: 'Site email provider', provider: 'payload-email', configured: emailConfigured },
      ...result.results.map(item => ({ id: String(item.id), label: item.label, provider: item.provider, configured: item.provider === 'payload-email' ? emailConfigured : true })),
    ] }, { headers: { 'Cache-Control': 'no-store' } })
  } }, { path: '/forms-deliveries/:id/message', method: 'get', handler: async req => {
    const site = platform.resolveSite?.(req) || FORM_SITE
    if (!platform.local || !canForm(req.user as FormsUser, 'integrations', site)) return new Response('Not found.', { status: 404 })
    const delivery = await platform.db.prepare('SELECT event_i_d,body,headers FROM form_deliveries WHERE id=? AND site=?').bind(String(req.routeParams?.id || ''), site).first<{ event_i_d: string; body: string; headers: string | null }>()
    if (!delivery) return new Response('Not found.', { status: 404 })
    const metadata = JSON.parse(delivery.headers || '{}') as { envelope?: string; draftID?: number; tokenHash?: string }
    if (metadata.envelope) {
      const active = await platform.db.prepare('SELECT id FROM form_drafts WHERE id=? AND site=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(metadata.draftID!, site, metadata.tokenHash!, new Date().toISOString()).first()
      if (!active) return new Response('This resume link expired, was revoked, or was replaced.', { status: 410 })
    }
    try {
      const body = metadata.envelope ? await openMessage(req.payload.secret, `${site}:${delivery.event_i_d}:delivery`, metadata.envelope) : delivery.body
      return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } })
    } catch { return new Response('The private message could not be recovered with the current server key.', { status: 409 }) }
  } }, { path: '/forms-actions/maintenance', method: 'post', handler: async req => {
    const site = platform.resolveSite?.(req) || FORM_SITE
    if (!canForm(req.user as FormsUser, 'admin', site)) return Response.json({ message: 'Form administration permission is required.' }, { status: 403 })
    if (!req.url || req.headers.get('origin') !== new URL(req.url).origin) return Response.json({ message: 'A same-origin request is required.' }, { status: 403 })
    return Response.json(await maintainForms(platform, site), { headers: { 'Cache-Control': 'no-store' } })
  } }, { path: '/forms-actions/run', method: 'post', handler: async req => {
    const site = platform.resolveSite?.(req) || FORM_SITE
    if (!canForm(req.user as FormsUser, 'integrations', site)) return Response.json({ message: 'Integration permission is required.' }, { status: 403 })
    if (!req.url || req.headers.get('origin') !== new URL(req.url).origin) return Response.json({ message: 'A same-origin request is required.' }, { status: 403 })
    try {
      const body = await readBoundedJSON(req, 2000), processor = new FormOutbox(platform.db, createActionHandlers(platform, req.payload), undefined, platform.local)
      if (body.replay !== undefined) {
        if (!Number.isSafeInteger(body.replay) || Number(body.replay) < 1) return Response.json({ message: 'Choose a valid action.' }, { status: 400 })
        await processor.replay(site, Number(body.replay))
      }
      return Response.json({ processed: await processor.run(site, 10) }, { headers: { 'Cache-Control': 'no-store' } })
    } catch { return Response.json({ message: 'Could not process this request. Only failed or unconfigured actions can be replayed.' }, { status: 400 }) }
  } }, { path: '/forms-actions/tick', method: 'post', handler: async req => {
    const secret = process.env.FORM_JOB_TOKEN
    if (!secret || secret.length < 32 || !constantEqual(req.headers.get('authorization') || '', `Bearer ${secret}`)) return Response.json({ message: 'Job authentication is required.' }, { status: 403 })
    const processor = new FormOutbox(platform.db, createActionHandlers(platform, req.payload), undefined, platform.local)
    const now = new Date().toISOString()
    const sites = await platform.db.prepare("SELECT site FROM form_outbox WHERE (status='pending' AND next_attempt_at<=?) OR (status='running' AND lease_until<=?) UNION SELECT site FROM form_attachments WHERE submission_i_d IS NULL AND (expires_at<=? OR scan_status='deleting') UNION SELECT site FROM form_drafts WHERE expires_at<=? OR revoked_at IS NOT NULL UNION SELECT site FROM form_booking_holds WHERE status='held' AND expires_ms<=? UNION SELECT site FROM form_exports WHERE status='pending' OR (status='complete' AND expires_at<=?) OR (status='expired' AND object_key IS NOT NULL) ORDER BY site LIMIT 10").bind(now, now, now, now, Date.now(), now).all<{ site: string }>()
    let processed = 0
    const maintenance = []
    for (const { site } of sites.results) { processed += await processor.run(site, 5); maintenance.push({ site, ...await maintainForms(platform, site) }) }
    return Response.json({ processed, maintenance }, { headers: { 'Cache-Control': 'no-store' } })
  } }]
}
