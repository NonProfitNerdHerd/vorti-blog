import type { Endpoint } from 'payload'
import { surveyAccumulator, type Answers, type FormDefinition } from '@design-system/payload-design-core/forms'
import { canForm, FORM_SITE, type FormsUser } from './access'
import type { FormPlatform } from './platform'
import { FormHTTPError } from './security'

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
export function formSurveyEndpoints(platform: FormPlatform): Endpoint[] {
  return [{ path: '/forms-surveys/:id', method: 'get', handler: async req => {
    try {
      // Resolve published state, never unpublished access-setting changes.
      const identifier = String(req.routeParams?.id || '')
      const url = new URL(req.url!)
      const found = await req.payload.find({ collection: 'forms', overrideAccess: true, draft: false, depth: 0, limit: 1,
        where: url.searchParams.get('lookup') !== 'slug' ? { id: { equals: identifier } } : { and: [{ slug: { equals: identifier } }, { site: { equals: platform.resolveSite?.(req) || FORM_SITE } }] } })
      const form = found.docs[0]
      if (!form) throw new FormHTTPError('Survey results are unavailable.', 404)
      const staff = canForm(req.user as FormsUser, 'entries', form.site)
      if (!staff && (form.site !== (platform.resolveSite?.(req) || FORM_SITE) || form.archived || form._status !== 'published')) throw new FormHTTPError('Survey results are unavailable.', 404)
      if (!staff && (url.searchParams.has('revision') || url.searchParams.has('from') || url.searchParams.has('to'))) throw new FormHTTPError('Public results do not allow historical or date filters.', 400)
      const revision = staff ? url.searchParams.get('revision') || form.publishedRevision : form.publishedRevision
      const snapshots = await req.payload.find({ collection: 'form-revisions', overrideAccess: true, depth: 0, limit: 1,
        where: { and: [{ form: { equals: form.id } }, { site: { equals: form.site } }, { revision: { equals: revision || '' } }] } })
      const snapshot = snapshots.docs[0]
      if (!snapshot || (!staff && snapshot.retiredAt)) throw new FormHTTPError('Survey revision is unavailable.', 404)
      const definition = snapshot.definition as unknown as FormDefinition
      if (!staff && (!definition.access.publicResults || (definition.access.authenticated && !req.user))) throw new FormHTTPError('Survey results are private.', 403)
      const from = new Date(url.searchParams.get('from') || 0), to = new Date(url.searchParams.get('to') || Date.now())
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw new FormHTTPError('Choose valid From and Through dates.')
      const params = [form.site, form.id, String(revision), from.toISOString(), to.toISOString()]
      const predicate = 'site=? AND form_id=? AND revision=? AND created_at>=? AND created_at<? AND COALESCE(spam,0)=0 AND COALESCE(archived,0)=0'
      const ceiling = await platform.db.prepare(`SELECT MAX(id) AS id, COUNT(*) AS total FROM form_submissions WHERE ${predicate}`).bind(...params).first<{ id: number; total: number }>()
      // Bounded synchronous aggregation fails explicitly rather than reporting a partial sample.
      if ((ceiling?.total || 0) > 10000) throw new FormHTTPError(staff ? 'Choose a shorter date range; this report is limited to 10,000 entries.' : 'These results exceed the current reporting limit.', 422)
      if (!staff && (ceiling?.total || 0) < 5) return Response.json({ title: snapshot.title, pending: true, message: 'Results become available after at least five responses.', fields: [] }, { headers })
      const accumulator = surveyAccumulator(definition.fields)
      let cursor = 0, entries = 0
      while (cursor < (ceiling?.id || 0)) {
        const page = await platform.db.prepare(`SELECT id,answers FROM form_submissions WHERE ${predicate} AND id>? AND id<=? ORDER BY id LIMIT 100`).bind(...params, cursor, ceiling!.id).all<{ id: number; answers: string }>()
        if (!page.results.length) break
        for (const row of page.results) { accumulator.add(JSON.parse(row.answers) as Answers); cursor = row.id; entries++ }
      }
      const fields = accumulator.result()
      return Response.json({ title: snapshot.title, revision, from: from.toISOString(), to: to.toISOString(), entries,
        fields: staff ? fields : fields.filter(field => field.responses >= 5).map(field => ({ ...field, rows: field.rows?.filter(row => row.responses >= 5) })),
        privacy: 'Sensitive fields and free-text answers are excluded. Repeated fields count individual items, not people.' }, { headers })
    } catch (error) {
      return Response.json({ message: error instanceof FormHTTPError ? error.message : 'Could not load survey results.' }, { status: error instanceof FormHTTPError ? error.status : 500, headers })
    }
  } }]
}
