import type { Endpoint } from 'payload'
import type { FormField } from '@design-system/payload-design-core/forms'
import { canForm, permittedSites, type FormsUser } from './access'
import type { FormPlatform } from './platform'
import { safeFilename } from './security'

export function sensitiveField(fields: FormField[], id: string, inherited = false): boolean {
  return fields.some(field => field.id === id ? inherited || !!field.sensitive : sensitiveField(field.children || [], id, inherited || !!field.sensitive))
}
export function formFileEndpoints(platform: FormPlatform): Endpoint[] {
  return [{ path: '/forms-files/:id', method: 'get', handler: async req => {
    const user = req.user as FormsUser | undefined
    if (!permittedSites(user, 'entries').length) return Response.json({ message: 'Entry access is required.' }, { status: 403 })
    const id = String(req.routeParams?.id || '')
    if (!/^\d+$/.test(id)) return Response.json({ message: 'Attachment not found.' }, { status: 404 })
    const file = await platform.db.prepare('SELECT a.site, a.object_key, a.filename, a.field_i_d, a.scan_status, s.schema_snapshot FROM form_attachments a JOIN form_submissions s ON a.submission_i_d=CAST(s.id AS TEXT) AND a.site=s.site WHERE a.id=?').bind(id).first<{ site: string; object_key: string; filename: string; field_i_d: string; scan_status: string; schema_snapshot: string }>()
    if (!file || !canForm(user, 'entries', file.site)) return Response.json({ message: 'Attachment not found.' }, { status: 404 })
    const schema = JSON.parse(file.schema_snapshot) as { fields: FormField[] }
    if (sensitiveField(schema.fields, file.field_i_d) && !canForm(user, 'sensitive', file.site)) return Response.json({ message: 'Sensitive-entry permission is required.' }, { status: 403 })
    if (!['unscanned', 'clean'].includes(file.scan_status)) return Response.json({ message: 'This attachment is quarantined or awaiting a scan.' }, { status: 409 })
    const object = await platform.storage.get(file.object_key)
    if (!object) return Response.json({ message: 'Attachment is no longer available.' }, { status: 410 })
    return new Response(object.body, { headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(object.size),
      'Content-Disposition': `attachment; filename="${safeFilename(file.filename)}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'X-Form-Scan-Status': file.scan_status,
    } })
  } }]
}
