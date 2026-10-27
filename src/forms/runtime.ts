import { PUBLIC_PREFIX_HEADER, publicWebsite } from '../organizations/public-website'
import { featureAvailableAt, tenantAuthorityActive } from '../organizations/tenant-runtime'
import { formHostFeature, formSessionScope } from './host-feature'
import { runGraph, graphScope, graphAnswers, type GraphEvent } from '@design-system/payload-design-core/forms'
import type { Endpoint, PayloadRequest } from 'payload'
import { validateAnswers, validateTemporal, publicDefinition, flattenFields, answerFields, attachmentReferences, type Answers, type FormDefinition } from '@design-system/payload-design-core/forms'
import { FORM_INTERNAL, FORM_SITE } from './access'
import { FormHTTPError, checkOrigin, constantEqual, hashToken, hmac, randomToken, readBoundedJSON, rateLimit, fileSignature, safeFilename } from './security'
import type { FormPlatform } from './platform'
import { acceptSubmission } from './acceptance'
import { FormOutbox } from './outbox'
import { createActionHandlers } from './action-runtime'
import { BookingStore } from './booking'
import { scanUpload } from './maintenance'
import { receiptResponse, type ReceiptEntry } from './receipts'
import { analyticsEvent, recordAnalytics } from './analytics'
import { transferProgress } from './progress'
import { sealMessage } from './private-message'
import { embedOrigin } from '../../packages/payload-design-core/src/forms/embed'
import { escapeHTML } from './action-runtime'
import { paymentQuote } from '@design-system/payload-design-core/forms'
import { paymentToken, type PaymentRow } from './payment-store'

const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers } })
const internal = (req: PayloadRequest): PayloadRequest => ({ ...req, context: { ...req.context, formsOperation: 'public-runtime', [FORM_INTERNAL]: true } })
const errors = (handler: (req: PayloadRequest) => Promise<Response>) => async (req: PayloadRequest): Promise<Response> => {
  try { return await handler(req) } catch (error) {
    if (error instanceof FormHTTPError) return response({ message: error.message }, error.status)
    // Avoid logging request bodies, tokens, recipient addresses or provider credentials.
    req.payload.logger.error({ msg: 'Forms request failed', errorType: error instanceof Error ? error.name : 'UnknownError' })
    return response({ message: 'The form service could not complete this request. Your answers have not been cleared.' }, 500)
  }
}
async function session(req: PayloadRequest, revision: string, issue = false, fresh = false): Promise<{ token: string; hash: string }> {
  const secret = req.payload.secret
  revision = formSessionScope(revision, req.headers)
  const supplied = fresh ? '' : req.headers.get('x-form-session') || ''
  if (supplied) {
    const [nonce, expiry, signature] = supplied.split('.')
    if (!/^[a-f0-9]{64}$/.test(nonce) || Number(expiry) < Date.now() || !constantEqual(signature || '', await hmac(secret, `${revision}.${nonce}.${expiry}`))) throw new FormHTTPError('Your form session expired. Reload the form or resume saved progress.', 401)
    return { token: supplied, hash: await hashToken(nonce) }
  }
  if (!issue) throw new FormHTTPError('Start a form session before submitting.', 401)
  const nonce = randomToken(), expiry = String(Date.now() + 24 * 3600000)
  return { token: `${nonce}.${expiry}.${await hmac(secret, `${revision}.${nonce}.${expiry}`)}`, hash: await hashToken(nonce) }
}
async function published(req: PayloadRequest, platform: FormPlatform, revisionID?: string) {
  const site = platform.resolveSite?.(req) || FORM_SITE
  if (!await featureAvailableAt(platform.db, site, 'forms')) throw new FormHTTPError('Form unavailable.',404)
  const host = formHostFeature(req.headers)
  if (host && !await featureAvailableAt(platform.db, site, host)) throw new FormHTTPError('Form unavailable.',404)
  if ((site !== FORM_SITE || await tenantAuthorityActive(platform.db,site)) && !await publicWebsite(platform.db,site)) throw new FormHTTPError('Form unavailable.',404)
  const slug = String(req.routeParams?.slug || '')
  // Deliberate public read: query is server-built, published-only and site-scoped; private data never leaves projection.
  const forms = await req.payload.find({ collection: 'forms', overrideAccess: true, draft: false, depth: 0, limit: 1,
    where: { and: [{ slug: { equals: slug } }, { site: { equals: site } }, { _status: { equals: 'published' } }, { archived: { not_equals: true } }] } })
  const form = forms.docs[0]
  if (!form?.publishedRevision) throw new FormHTTPError('This form is not currently published.', 404)
  const revision = await req.payload.find({ collection: 'form-revisions', overrideAccess: true, depth: 0, limit: 1,
    where: { and: [{ revision: { equals: revisionID || form.publishedRevision } }, { form: { equals: form.id } }, { site: { equals: site } }] } })
  const snapshot = revision.docs[0]
  if (!snapshot || snapshot.retiredAt) throw new FormHTTPError('This revision has been retired. Your saved answers remain available for recovery; contact the form owner.', 409)
  const definition = snapshot.definition as unknown as FormDefinition
  if (definition.access.authenticated && !req.user) throw new FormHTTPError('Sign in to use this form.', 401)
  return { site, form, snapshot, definition }
}
export function formRuntimeEndpoints(platform: FormPlatform): Endpoint[] {
  return [
    { path: '/forms-embed/:slug', method: 'get', handler: errors(async req => {
      const { form, definition } = await published(req, platform)
      const url = new URL(req.url!), own = url.origin
      const allowed = [...new Set(definition.access.embedOrigins.map(embedOrigin).filter((origin): origin is string => !!origin))]
      const parent = url.searchParams.get('parentOrigin') || own, instance = url.searchParams.get('instance') || ''
      if (![own, ...allowed].includes(parent)) throw new FormHTTPError('This website is not allowed to embed this form.', 403)
      if (instance && !/^[a-zA-Z0-9_-]{1,100}$/.test(instance)) throw new FormHTTPError('Invalid embed instance.')
      const html = `<!doctype html><html lang="${escapeHTML(definition.locale)}" dir="${definition.direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHTML(form.title)}</title><link rel="stylesheet" href="/forms-assets/runtime.css"></head><body><div id="form-root" data-slug="${escapeHTML(String(form.slug))}" data-site-prefix="${escapeHTML(req.headers.get(PUBLIC_PREFIX_HEADER) || '')}" data-parent-origin="${escapeHTML(parent)}" data-instance="${escapeHTML(instance)}"><p>Loading form…</p></div><script src="/forms-assets/runtime.js" defer></script></body></html>`
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob: https:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' ${allowed.join(' ')}` } })
    }) },
    { path: '/forms-options', method: 'get', handler: errors(async req => {
      if (!req.user) throw new FormHTTPError('Sign in to select a form.', 401)
      const site = platform.resolveSite?.(req) || FORM_SITE
      const search = new URL(req.url!).searchParams.get('where[title][like]')?.slice(0, 200) || ''
      const forms = await req.payload.find({ collection: 'forms', overrideAccess: true, draft: false, depth: 0, limit: 50, sort: 'title', where: { and: [{ site: { equals: site } }, { _status: { equals: 'published' } }, { archived: { not_equals: true } }, { publishedRevision: { exists: true } }, ...(search ? [{ title: { like: search } }] : [])] } })
      return response({ docs: forms.docs.map(form => ({ id: form.id, title: form.title })) })
    }) },
    { path: '/forms-placement/:id', method: 'get', handler: errors(async req => {
      const site = platform.resolveSite?.(req) || FORM_SITE
      const found = await req.payload.find({ collection: 'forms', overrideAccess: true, draft: false, depth: 0, limit: 1, where: { and: [{ id: { equals: String(req.routeParams?.id || '') } }, { site: { equals: site } }, { _status: { equals: 'published' } }, { archived: { not_equals: true } }] } })
      if (!found.docs[0]) throw new FormHTTPError('This form is not currently published.', 404)
      const { form, snapshot, definition } = await published({ ...req, routeParams: { ...req.routeParams, slug: found.docs[0].slug } }, platform)
      return response({ slug: form.slug, title: snapshot.title, definition: publicDefinition(definition) })
    }) },
    { path: '/forms-runtime/:slug/progress-email', method: 'post', handler: errors(async req => {
      const body = await readBoundedJSON(req, 4000), revision = String(body.revision || ''), token = String(body.token || ''), email = String(body.email || '').trim()
      const { site, form, definition } = await published(req, platform, revision)
      checkOrigin(req, definition)
      const auth = await session(req, revision)
      if (!definition.access.saveProgress) throw new FormHTTPError('Saving progress is disabled.', 403)
      if (!/^[a-f0-9]{64}$/.test(token) || email.length > 254 || !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email)) throw new FormHTTPError('Save progress first and enter a valid email address.')
      if (!platform.local && req.payload.email.name === 'console') throw new FormHTTPError('Resume email is not configured. Copy your private link instead.', 503)
      await rateLimit(platform.db, await hmac(req.payload.secret, `resume-email:${site}:${req.headers.get('cf-connecting-ip') || auth.hash}`), 3)
      await rateLimit(platform.db, await hmac(req.payload.secret, `resume-recipient:${site}:${email.toLowerCase()}`), 3)
      const tokenHash = await hashToken(token)
      const draft = await platform.db.prepare('SELECT id FROM form_drafts WHERE site=? AND revision=? AND token_hash=? AND session_hash=? AND revoked_at IS NULL AND expires_at>? AND (owner_i_d IS NULL OR owner_i_d=?)').bind(site, revision, tokenHash, auth.hash, new Date().toISOString(), String(req.user?.id || '')).first<{ id: number }>()
      if (!draft) throw new FormHTTPError('Saved progress is unavailable in this session. Save it again before requesting an email.', 404)
      const eventID = randomToken(), now = new Date().toISOString()
      const url = new URL(`${req.headers.get(PUBLIC_PREFIX_HEADER) || ''}/forms/${encodeURIComponent(String(req.routeParams?.slug))}`, req.url).href + `#resume=${token}`
      const envelope = await sealMessage(req.payload.secret, `${site}:${eventID}`, JSON.stringify({ email, url, title: form.title }))
      const action = { id: eventID, kind: 'resume-email', name: 'Resume saved progress', config: { draftID: draft.id, tokenHash, envelope } }
      await platform.db.prepare("INSERT INTO form_outbox(label,site,event_i_d,revision,kind,status,payload,attempts,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,'resume-email','pending',?,0,?,?,?)").bind('Resume email', site, eventID, revision, JSON.stringify({ action }), now, now, now).run()
      platform.defer?.(async () => { try { await new FormOutbox(platform.db, createActionHandlers(platform, req.payload), undefined, platform.local).run(site, 5) } catch { req.payload.logger.error({ msg: 'Resume email remains queued for retry.' }) } })
      return response({ message: platform.local ? 'Resume email queued in the local development outbox; no external email was sent.' : 'Resume email queued for delivery.' }, 202)
    }) },
    { path: '/forms-runtime/:slug/drafts', method: 'get', handler: errors(async req => {
      if (!req.user) throw new FormHTTPError('Sign in to see your saved drafts.', 401)
      const { site, form } = await published(req, platform)
      const cursor = Math.max(0, Number(new URL(req.url || 'https://local.invalid').searchParams.get('after')) || 0)
      const result = await platform.db.prepare(`SELECT d.id,d.label,d.revision,d.updated_at AS updatedAt,d.expires_at AS expiresAt,r.retired_at AS retiredAt FROM form_drafts d JOIN form_revisions r ON r.revision=d.revision AND r.site=d.site WHERE d.site=? AND r.form_id=? AND d.owner_i_d=? AND d.revoked_at IS NULL AND d.expires_at>? AND d.id>? ORDER BY d.id LIMIT 21`).bind(site, form.id, String(req.user.id), new Date().toISOString(), cursor).all<{ id: number; label: string; revision: string; updatedAt: string; expiresAt: string; retiredAt: string | null }>()
      const drafts = result.results.slice(0, 20)
      return response({ drafts, next: result.results.length > 20 ? drafts.at(-1)?.id : null })
    }) },
    { path: '/forms-runtime/:slug/revoke', method: 'post', handler: errors(async req => {
      const body = await readBoundedJSON(req, 4000)
      const { site, form, definition } = await published(req, platform)
      checkOrigin(req, definition)
      const byAccount = body.id !== undefined
      if (byAccount && !req.user) throw new FormHTTPError('Sign in to manage your saved drafts.', 401)
      if (!byAccount && !/^[a-f0-9]{64}$/.test(String(body.token || ''))) throw new FormHTTPError('Invalid saved draft.', 404)
      const now = new Date().toISOString()
      const result = await platform.db.prepare(`UPDATE form_drafts SET revoked_at=?,updated_at=? WHERE site=? AND ${byAccount ? 'id=? AND owner_i_d=?' : 'token_hash=? AND (owner_i_d IS NULL OR owner_i_d=?)'} AND revoked_at IS NULL AND revision IN (SELECT revision FROM form_revisions WHERE site=? AND form_id=?)`).bind(now, now, site, byAccount ? String(body.id) : await hashToken(String(body.token)), String(req.user?.id || ''), site, form.id).run()
      if (result.meta.changes !== 1) throw new FormHTTPError('Saved draft not found for this account or private link.', 404)
      return response({ message: 'Saved progress revoked. Its private link no longer works.' })
    }) },
    { path: '/forms-runtime/:slug/receipt', method: 'post', handler: errors(async req => {
      const body = await readBoundedJSON(req, 4000), revision = String(body.revision || '')
      const { site, form, definition } = await published(req, platform, revision)
      checkOrigin(req, definition)
      const auth = await session(req, revision)
      const entry = await platform.db.prepare('SELECT id,site,revision,created_at,schema_snapshot,answers FROM form_submissions WHERE site=? AND form_id=? AND revision=? AND session_hash=? AND idempotency_key=?').bind(site, form.id, revision, auth.hash, String(body.receipt || '')).first<ReceiptEntry>()
      if (!entry) throw new FormHTTPError('This receipt does not belong to your form session.', 404)
      return receiptResponse(entry, true)
    }) },
    { path: '/forms-runtime/:slug/analytics', method: 'post', handler: errors(async req => {
      const body = await readBoundedJSON(req, 8000), revision = String(body.revision || '')
      const { site, form, definition } = await published(req, platform, revision)
      checkOrigin(req, definition)
      const auth = await session(req, revision)
      const event = analyticsEvent(definition, body)
      if (event) {
        await rateLimit(platform.db, `analytics:${site}:${auth.hash}`, 120)
        await recordAnalytics(platform.db, site, form.id, revision, auth.hash, event)
      }
      return response({ recorded: !!event })
    }) },
    { path: '/forms-runtime/:slug/booking', method: 'post', handler: errors(async req => {
      const body = await readBoundedJSON(req, 8000), revision = String(body.revision || '')
      const { site, definition } = await published(req, platform, revision)
      checkOrigin(req, definition)
      const auth = await session(req, revision), store = new BookingStore(platform.db)
      const field = flattenFields(definition.fields).find(field => field.id === body.field && field.kind === 'datetime' && field.date?.resource)
      if (!field?.date?.resource) throw new FormHTTPError('This field is not configured for booking.')
      const resources = await req.payload.find({ collection: 'form-resources', overrideAccess: true, depth: 0, limit: 1, where: { and: [{ id: { equals: field.date.resource } }, { site: { equals: site } }] } })
      const resource = resources.docs[0]
      if (!resource) throw new FormHTTPError('This booking resource is unavailable.', 404)
      const configured = new Set((Array.isArray(resource.availability) ? resource.availability : []).map(slot => String((slot as { id?: string }).id)))
      if (body.operation === 'release') {
        await store.release(site, String(body.token || ''), auth.hash)
        return response({ released: true })
      }
      if (body.operation === 'hold') {
        await rateLimit(platform.db, await hmac(req.payload.secret, `booking:${site}:${req.headers.get('cf-connecting-ip') || auth.hash}`), 20)
        const slot = await platform.db.prepare('SELECT id, starts_at, ends_at FROM form_booking_slots WHERE id=? AND site=? AND resource=?').bind(String(body.slot || ''), site, String(resource.id)).first<{ id: string; starts_at: string; ends_at: string }>()
        if (!slot || !configured.has(slot.id)) throw new FormHTTPError('This booking time is unavailable.', 409)
        const issues = validateTemporal(field, slot.starts_at, new Date())
        if (issues.length) throw new FormHTTPError(issues.join(' '))
        const hold = await store.hold(site, slot.id, auth.hash, 1, resource.holdMinutes || 10)
        return response({ ...hold, startsAt: slot.starts_at, endsAt: slot.ends_at }, 201)
      }
      const from = new Date(String(body.from || '')), to = new Date(String(body.to || ''))
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 93 * 86400000) throw new FormHTTPError('Choose an availability window of up to 93 days.')
      const slots = await store.available(site, String(resource.id), from.toISOString(), to.toISOString())
      return response({ slots: slots.filter(slot => configured.has(String(slot.id)) && Number(slot.remaining) > 0 && !validateTemporal(field, String(slot.starts_at), new Date()).length).map(slot => ({ id: slot.id, startsAt: slot.starts_at, endsAt: slot.ends_at, remaining: slot.remaining })) })
    }) },
    { path: '/forms-runtime/:slug', method: 'get', handler: errors(async req => {
      const { form, snapshot, definition } = await published(req, platform)
      const auth = await session(req, snapshot.revision, true)
      return response({ title: snapshot.title, description: form.description, revision: snapshot.revision, definition: publicDefinition(definition), session: auth.token })
    }) },
    { path: '/forms-runtime/:slug/progress', method: 'post', handler: errors(async req => {
      const body = await readBoundedJSON(req), revision = String(body.revision || '')
      const { site, form, definition } = await published(req, platform, revision)
      checkOrigin(req, definition)
      if (!definition.access.saveProgress) throw new FormHTTPError('Saving progress is disabled.', 403)
      const auth = await session(req, revision)
      await rateLimit(platform.db, `draft:${site}:${form.id}:${auth.hash}`, 20)
      if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) throw new FormHTTPError('Invalid answers.')
      const answers = body.answers as Answers
      const known = new Set(flattenFields(definition.fields).map(field => field.id))
      if (Object.keys(answers).some(key => !known.has(key))) throw new FormHTTPError('Unknown answer field.')
      const expiresAt = new Date(Date.now() + Math.max(1, Math.min(definition.access.draftDays, 365)) * 86400000).toISOString()
      for (const { field, references } of attachmentReferences(definition.fields, answers)) for (const ref of references) {
        const updated = await platform.db.prepare("UPDATE form_attachments SET expires_at=? WHERE id=? AND field_i_d=? AND site=? AND revision=? AND session_hash=? AND submission_i_d IS NULL AND expires_at>? AND scan_status!='deleting'").bind(expiresAt, ref, field.id, site, revision, auth.hash, new Date().toISOString()).run()
        if (updated.meta.changes !== 1) throw new FormHTTPError('A saved attachment is unavailable or belongs to another form session.', 403)
      }
      const token = typeof body.resumeToken === 'string' ? body.resumeToken : randomToken()
      const tokenHash = await hashToken(token)
      let draftID: number
      if (body.resumeToken) {
        const drafts = await req.payload.find({ collection: 'form-drafts', req: internal(req), overrideAccess: true, depth: 0, limit: 1, where: { and: [{ tokenHash: { equals: tokenHash } }, { site: { equals: site } }, { revision: { equals: revision } }, { sessionHash: { equals: auth.hash } }] } })
        const draft = drafts.docs[0]
        if (!draft || draft.revokedAt || Date.parse(draft.expiresAt || '') <= Date.now()) throw new FormHTTPError('Saved progress expired or was revoked.', 410)
        if (draft.ownerID && String(req.user?.id) !== draft.ownerID) throw new FormHTTPError('Sign in with the account that saved this form.', 403)
        const changed = await platform.db.prepare('UPDATE form_drafts SET answers=?,expires_at=?,updated_at=? WHERE id=? AND site=? AND session_hash=? AND revoked_at IS NULL AND expires_at>?').bind(JSON.stringify(answers), expiresAt, new Date().toISOString(), draft.id, site, auth.hash, new Date().toISOString()).run()
        if (changed.meta.changes !== 1) throw new FormHTTPError('Saved progress was resumed elsewhere or revoked. Reload before saving again.', 409)
        draftID = draft.id
      } else {
        const draft = await req.payload.create({ collection: 'form-drafts', req: internal(req), overrideAccess: true, data: { label: `${form.title} · saved progress`, site, revision, tokenHash, answers, expiresAt, sessionHash: auth.hash, ownerID: req.user ? String(req.user.id) : undefined } })
        draftID = draft.id
      }
      return response({ message: 'Progress saved. Keep this private link to return to your answers.', draftID, resumeToken: token, resumePath: `/forms/${encodeURIComponent(String(req.routeParams?.slug))}#resume=${encodeURIComponent(token)}`, expiresAt })
    }) },
    { path: '/forms-runtime/:slug/resume', method: 'post', handler: errors(async req => {
      const body = await readBoundedJSON(req, 4000), token = String(body.token || '')
      const byAccount = body.id !== undefined
      if (byAccount && !req.user) throw new FormHTTPError('Sign in to resume your saved draft.', 401)
      if (!byAccount && !/^[a-f0-9]{64}$/.test(token)) throw new FormHTTPError('Invalid resume link.', 404)
      const site = platform.resolveSite?.(req) || FORM_SITE
      const drafts = await req.payload.find({ collection: 'form-drafts', overrideAccess: true, limit: 1, depth: 0, where: { and: [byAccount ? { id: { equals: String(body.id) } } : { tokenHash: { equals: await hashToken(token) } }, { site: { equals: site } }, ...(byAccount ? [{ ownerID: { equals: String(req.user!.id) } }] : [])] } })
      const draft = drafts.docs[0]
      if (!draft || draft.revokedAt || Date.parse(draft.expiresAt || '') <= Date.now()) throw new FormHTTPError('This saved progress link expired or was revoked.', 410)
      if (draft.ownerID && String(req.user?.id) !== draft.ownerID) throw new FormHTTPError('Sign in with the account that saved this form.', 403)
      const { form, snapshot, definition } = await published(req, platform, draft.revision)
      checkOrigin(req, definition)
      const auth = await session(req, draft.revision, true, true)
      // Only attachments already recorded in this verified draft can transfer to the resumed session.
      const refs = attachmentReferences(definition.fields, draft.answers as Answers).flatMap(item => item.references)
      const resumedToken = byAccount ? randomToken() : token
      await transferProgress(platform.db, { id: draft.id, site, revision: draft.revision, previousSession: draft.sessionHash || '', session: auth.hash, updatedAt: draft.updatedAt, expiresAt: draft.expiresAt!, tokenHash: await hashToken(resumedToken), files: refs })
      return response({ title: snapshot.title, description: form.description, revision: snapshot.revision, definition: publicDefinition(definition), session: auth.token, answers: draft.answers, draftID: draft.id, resumeToken: resumedToken })
    }) },
    { path: '/forms-runtime/:slug/upload', method: 'post', handler: errors(async req => {
      const revision = req.headers.get('x-form-revision') || '', fieldID = req.headers.get('x-form-field') || ''
      const { site, definition } = await published(req, platform, revision)
      checkOrigin(req, definition)
      const auth = await session(req, revision), field = flattenFields(definition.fields).find(f => f.id === fieldID && f.kind === 'upload')
      if (!field) throw new FormHTTPError('Upload field not found.')
      await rateLimit(platform.db, `upload:${site}:${auth.hash}`, 20)
      const mime = req.headers.get('content-type')?.split(';')[0] || '', size = Number(req.headers.get('content-length'))
      const limit = Math.min(field.files?.maxBytes || 10485760, 25 * 1024 * 1024)
      if (!field.files?.mimeTypes.includes(mime)) throw new FormHTTPError('This file type is not allowed.')
      if (size > limit) throw new FormHTTPError('File is too large.', 413)
      const reader = req.body?.getReader(); if (!reader) throw new FormHTTPError('File data is required.')
      const chunks: Uint8Array[] = []; let length = 0
      while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > limit) { await reader.cancel(); throw new FormHTTPError('File is too large.', 413) } chunks.push(part.value) }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      if (!fileSignature(bytes, mime)) throw new FormHTTPError('File content does not match an allowed file type.')
      const name = safeFilename(req.headers.get('x-file-name') || 'attachment'), key = `form-private/${site}/${randomToken()}`
      const scanStatus = await scanUpload(platform.scanner, bytes, mime, name)
      await platform.storage.put(key, bytes, { httpMetadata: { contentType: mime } })
      try {
        const attachment = await req.payload.create({ collection: 'form-attachments', req: internal(req), overrideAccess: true, data: { label: name, site, revision, sessionHash: auth.hash, objectKey: key, filename: name, mime, bytes: length, fieldID, scanStatus, expiresAt: new Date(Date.now() + 86400000).toISOString() } })
        return response({ id: String(attachment.id), name, status: scanStatus }, 201)
      } catch (error) { await platform.storage.delete(key); throw error }
    }) },
    { path: '/forms-runtime/:slug/submit', method: 'post', handler: errors(async req => {
      const body = await readBoundedJSON(req), revision = String(body.revision || '')
      const { site, form, snapshot, definition } = await published(req, platform, revision)
      checkOrigin(req, definition)
      const auth = await session(req, revision)
      await rateLimit(platform.db, await hmac(req.payload.secret, `submit:${site}:${form.id}:${req.headers.get('cf-connecting-ip') || auth.hash}`), definition.access.ratePerMinute)
      if (body.website) throw new FormHTTPError('Submission rejected.')
      if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) throw new FormHTTPError('Answers must be an object.')
      if (definition.access.turnstile) throw new FormHTTPError('Bot verification is not configured for this environment.', 503)
      if (!/^[a-zA-Z0-9_-]{16,100}$/.test(String(body.idempotencyKey || ''))) throw new FormHTTPError('A valid submission retry key is required.')
      let activeDefinition = definition, activeAnswers = body.answers as Answers
      if (definition.graph?.enabled) {
        const run = runGraph(definition, activeAnswers, body.navigation as GraphEvent[])
        if (run.error || run.node?.kind !== 'submit') throw new FormHTTPError(run.error || 'Follow the form flow to Submit.')
        activeDefinition = graphScope(definition, run); activeAnswers = graphAnswers(definition, activeDefinition, run.answers)
      }
      const evaluation = validateAnswers(activeDefinition, activeAnswers)
      if (evaluation.issues.length) {
        if (definition.access.analytics && (!definition.access.analyticsConsent || body.analyticsConsent === true)) {
          const knownFields = new Set(flattenFields(definition.fields).map(field => field.id))
          await recordAnalytics(platform.db, site, form.id, revision, auth.hash, { kind: 'error', eventID: randomToken(), fields: [...new Set(evaluation.issues.map(issue => issue.field).filter((field): field is string => !!field && knownFields.has(field)))] })
        }
        return response({ message: 'Please check the highlighted answers.', errors: evaluation.issues, analyticsRecorded: definition.access.analytics && (!definition.access.analyticsConsent || body.analyticsConsent === true) }, 400)
      }
      const attachments = attachmentReferences(definition.fields, evaluation.answers)
      let quote
      try { quote = paymentQuote(definition, evaluation.answers) } catch (error) { return response({ message: (error as Error).message, errors: [{ field: definition.payment?.amountField, path: definition.payment?.amountField || 'payment', message: (error as Error).message }] }, 400) }
      for (const { field, references: refs } of attachments) {
        if (refs.length > (field.files?.maxCount || 1)) throw new FormHTTPError(`${field.label}: Too many files.`)
      }
      const key = await hashToken(`${site}:${form.id}:${auth.hash}:${body.idempotencyKey}`)
      const bookingTokens = body.bookings && typeof body.bookings === 'object' && !Array.isArray(body.bookings) ? body.bookings as Record<string, unknown> : {}
      const bookings = []
      for (const { field, value, path } of answerFields(definition.fields, evaluation.answers)) if (field.kind === 'datetime' && field.date?.resource && value) {
        const token = bookingTokens[path]
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return response({ message: 'Reserve an available time before submitting.', errors: [{ field: field.id, path, message: `${field.label}: Choose an available time and reserve it again if the hold expired.` }] }, 400)
        bookings.push({ tokenHash: await hashToken(token), resource: field.date.resource, startsAt: new Date(String(value)).toISOString() })
      }
      const accepted = await acceptSubmission(platform.db, {
        hostFeature: formHostFeature(req.headers),
        formID: form.id, site, revision, key, sessionHash: auth.hash, answers: evaluation.answers,
        snapshot: { title: snapshot.title || form.title, fields: definition.fields, confirmation: evaluation.confirmation, redirect: definition.redirect },
        actions: definition.actions.filter(action => evaluation.actions.includes(action.id)),
        payment: Boolean(definition.payment),
        paymentDetails: quote,
        attachments: attachments.flatMap(item => item.references.map(id => ({ id, fieldID: item.field.id }))),
        bookings,
        analytics: definition.access.analytics && (!definition.access.analyticsConsent || body.analyticsConsent === true),
      })
      platform.defer?.(async () => {
        try { await new FormOutbox(platform.db, createActionHandlers(platform, req.payload), undefined, platform.local).run(site, 5) }
        catch { req.payload.logger.error({ msg: 'Forms action processing interrupted; durable jobs remain available for retry.' }) }
      })
      const payment = quote ? await platform.db.prepare('SELECT * FROM form_payment_sessions WHERE submission_key=? AND site=?').bind(key, site).first<PaymentRow>() : undefined
      return response({ accepted: true, receipt: key, message: evaluation.confirmation, redirect: quote ? undefined : definition.redirect,
        ...(payment ? { payment: { token: await paymentToken(req.payload.secret, payment) } } : {}),
      }, accepted.created ? 201 : 200)
    }) },
  ]
}
