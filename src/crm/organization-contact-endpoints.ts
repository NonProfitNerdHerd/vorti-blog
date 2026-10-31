import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { atomicSiteMutation, SiteConflictError } from '../organizations/atomic'
import { requireCRMAction } from './tenant-actions'

type LinkRow = {
  id: string; site_id: string; organization_id: string; person_id: string
  role: string; starts_on: string; ends_on: string | null; notes: string
  primary_contact: number; revision: number; organization_label: string; person_label: string
}
async function digest(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
export function organizationContactEndpoints(db: D1Database, errorResponse: (error: unknown) => Response): Endpoint[] {
  return [
    { path: '/crm/organization-contacts', method: 'get', handler: async req => {
      if (!req.user || req.user.collection !== 'users') return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
      try {
        const p = new URL(req.url!).searchParams
        const site = p.get('site') || ''
        const contact = p.get('contact') || ''
        const authority = new OrganizationRepository(db, Number(req.user.id))
        const scope = await authority.require(site, 'identity', 'read')
        await authority.require(site, 'affiliations', 'read')
        const row = await db.prepare(`SELECT c.kind FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id
          WHERE a.site_id=? AND a.archived=0 AND c.archived=0 AND c.id=?`).bind(site, contact).first<{ kind: string }>()
        if (!row) throw new SiteAccessError()
        const links = await db.prepare(`SELECT l.*,o.label organization_label,p.label person_label FROM vc_crm_organization_contacts l
          JOIN vc_crm_constituents o ON o.id=l.organization_id JOIN vc_crm_constituents p ON p.id=l.person_id
          WHERE l.site_id=? AND ${row.kind === 'organization' ? 'l.organization_id' : 'l.person_id'}=?
          ORDER BY l.primary_contact DESC,l.ends_on IS NOT NULL,l.starts_on DESC,l.id LIMIT 101`).bind(site, contact).all<LinkRow>()
        const canEdit = row.kind === 'organization' && (await authority.authority(site, 'identity', 'edit')).allowed && (await authority.authority(site, 'affiliations', 'edit')).allowed
        const epoch = await db.prepare('SELECT authority_revision FROM vc_organizations WHERE id=?').bind(scope.organization_id).first<{ authority_revision: number }>()
        if (epoch?.authority_revision !== scope.authorityRevision) throw new SiteConflictError()
        return Response.json({ docs: links.results.slice(0, 100), canEdit }, { headers: { 'Cache-Control': 'private, no-store' } })
      } catch (error) { return errorResponse(error) }
    } },
    { path: '/crm/organization-contacts', method: 'post', handler: async req => {
      if (!req.user || req.user.collection !== 'users') return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
      if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url!).origin)
        return Response.json({ message: 'Use the signed-in site to save changes.' }, { status: 403 })
      try {
        const body = await readBoundedJSON(req, 16000)
        const site = String(body.site || '')
        const organization = String(body.organization || '')
        const person = String(body.person || '')
        const role = String(body.role || '').trim()
        const notes = String(body.notes || '').trim()
        const startsOn = String(body.startsOn || '')
        const endsOn = body.endsOn ? String(body.endsOn) : null
        const primary = body.primary === true && !endsOn
        const id = typeof body.id === 'string' && body.id ? body.id : crypto.randomUUID()
        const revision = Number(body.expectedRevision)
        const operationKey = String(body.operationKey || '')
        if (role.length > 100 || notes.length > 1000 || !date(startsOn) || (endsOn && (!date(endsOn) || endsOn < startsOn)))
          throw new Error('Enter a valid role, dates, and notes.')
        const actor = Number(req.user.id)
        const authority = new OrganizationRepository(db, actor)
        const scope = await authority.require(site, 'identity', 'edit')
        await authority.require(site, 'affiliations', 'edit')
        const old = body.id ? await db.prepare('SELECT * FROM vc_crm_organization_contacts WHERE site_id=? AND id=?').bind(site, id).first<LinkRow>() : null
        if (body.id && (!old || old.revision !== revision || old.organization_id !== organization || old.person_id !== person)) throw new SiteConflictError()
        await requireCRMAction(db, actor, site, old ? 'crm:edit' : 'crm:create', scope.authorityRevision)
        const now = new Date().toISOString()
        const afterWrite = [
          ...(primary ? [db.prepare('UPDATE vc_crm_organization_contacts SET primary_contact=0,revision=revision+1,updated_at=? WHERE site_id=? AND organization_id=? AND primary_contact=1 AND ends_on IS NULL AND id<>?').bind(now, site, organization, id)] : []),
          old ? db.prepare(`UPDATE vc_crm_organization_contacts SET role=?,starts_on=?,ends_on=?,notes=?,primary_contact=?,revision=revision+1,updated_at=? WHERE site_id=? AND id=? AND revision=?`)
            .bind(role, startsOn, endsOn, notes, primary ? 1 : 0, now, site, id, revision)
            : db.prepare(`INSERT INTO vc_crm_organization_contacts(id,site_id,organization_id,person_id,role,starts_on,ends_on,notes,primary_contact,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id, site, organization, person, role, startsOn, endsOn, notes, primary ? 1 : 0, now, now),
          db.prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())').bind(`${operationKey}:link`),
          db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(`${operationKey}:link`),
          db.prepare(`INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,before_value,after_value,operation_key,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), scope.organization_id, site, actor,
              old ? 'organization-contact.updated' : 'organization-contact.created', 'organization-contact', id,
              old ? JSON.stringify(old) : null, JSON.stringify({ organization, person, role, startsOn, endsOn, notes, primary }), operationKey, now),
        ]
        const result = await atomicSiteMutation(db, {
          actor, operationKey,
          fingerprint: await digest({ site, organization, person, role, startsOn, endsOn, notes, primary, id: body.id || null, revision: body.id ? revision : null }),
          write: db.prepare('UPDATE vc_organizations SET authority_revision=authority_revision WHERE id=? AND authority_revision=?').bind(scope.organization_id, scope.authorityRevision),
          afterWrite,
          result: { id, revision: (old?.revision || 0) + 1 },
        })
        return Response.json({ doc: result }, { headers: { 'Cache-Control': 'private, no-store' } })
      } catch (error) { return errorResponse(error) }
    } },
  ]
}
