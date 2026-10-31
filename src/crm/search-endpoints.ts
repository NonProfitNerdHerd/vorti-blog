import type { Endpoint } from 'payload'
import { OrganizationRepository } from '../organizations/repository'

type SearchRow = {
  section: string
  subtype: string
  id: string
  label: string
  detail: string
}

/** Every branch is a fixed SQL fragment; user text is bound as a LIKE value. */
export function crmSearchEndpoints(db: D1Database, errorResponse: (error: unknown) => Response): Endpoint[] {
  return [{
    path: '/crm/search',
    method: 'get',
    handler: async req => {
      if (!req.user || req.user.collection !== 'users')
        return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
      try {
        const p = new URL(req.url!).searchParams
        const site = p.get('site') || 'default'
        const query = (p.get('q') || '').trim()
        const section = p.get('section') || 'all'
        const suggest = p.get('mode') === 'suggest'
        const page = Number(p.get('page') || 1)
        if (query.length < 2 || new TextEncoder().encode(query).length > 80)
          throw new Error('Search must contain 2 to 80 UTF-8 bytes.')
        if (!Number.isInteger(page) || page < 1 || page > 100)
          throw new Error('Invalid page cursor.')
        const valid = ['all', 'contacts', 'organizations', 'donations', 'households', 'fundraising', 'giving', 'memberships', 'opportunities', 'volunteers']
        if (!valid.includes(section)) throw new Error('Choose a valid search section.')
        const authority = new OrganizationRepository(db, Number(req.user.id))
        const identity = await authority.require(site, 'identity', 'read')
        const categories = ['finances', 'affiliations', 'memberships', 'restricted-activity', 'volunteer-experience', 'communications', 'volunteer-hours'] as const
        const access = Object.fromEntries(await Promise.all(categories.map(async category =>
          [category, (await authority.authority(site, category, 'read')).allowed],
        ))) as Record<(typeof categories)[number], boolean>
        const pattern = `%${query.replace(/[!%_]/g, value => `!${value}`)}%`
        const branches: string[] = []
        const binds: string[] = []
        const add = (target: string, sql: string, values: string[]) => {
          if (section !== 'all' && section !== target) return
          branches.push(sql)
          binds.push(...values)
        }
        add('contacts', `SELECT 'contacts' section,'person' subtype,c.id,c.label,'' detail
          FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id
          WHERE a.site_id=? AND a.archived=0 AND c.archived=0 AND c.kind='person'
          AND (c.label LIKE ? ESCAPE '!' OR c.profile LIKE ? ESCAPE '!')`, [site, pattern, pattern])
        add('organizations', `SELECT 'organizations' section,'organization' subtype,c.id,c.label,'' detail
          FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id
          WHERE a.site_id=? AND a.archived=0 AND c.archived=0 AND c.kind='organization'
          AND (c.label LIKE ? ESCAPE '!' OR c.profile LIKE ? ESCAPE '!')`, [site, pattern, pattern])
        if (access.finances) {
          add('donations', `SELECT 'donations' section,'gift' subtype,g.id,c.label, g.received_on detail
            FROM vc_crm_gifts g JOIN vc_crm_constituents c ON c.id=g.constituent_id
            WHERE g.site_id=? AND c.archived=0 AND (c.label LIKE ? ESCAPE '!' OR g.reference LIKE ? ESCAPE '!' OR g.notes LIKE ? ESCAPE '!')`, [site, pattern, pattern, pattern])
          for (const subtype of ['funds', 'campaigns', 'appeals'] as const)
            add('fundraising', `SELECT 'fundraising' section,'${subtype}' subtype,f.id,f.name AS label,'' detail
              FROM vc_crm_${subtype} f WHERE f.site_id=? AND f.archived=0
              AND (f.name LIKE ? ESCAPE '!' OR f.description LIKE ? ESCAPE '!')`, [site, pattern, pattern])
          add('giving', `SELECT 'giving' section,k.kind subtype,k.id,k.name AS label,c.label detail
            FROM vc_crm_commitments k JOIN vc_crm_constituents c ON c.id=k.constituent_id
            WHERE k.site_id=? AND c.archived=0 AND (k.name LIKE ? ESCAPE '!' OR c.label LIKE ? ESCAPE '!')`, [site, pattern, pattern])
        }
        if (access.affiliations)
          add('households', `SELECT 'households' section,'household' subtype,h.id,h.name AS label,h.address detail
            FROM vc_crm_households h WHERE h.site_id=? AND h.archived=0
            AND (h.name LIKE ? ESCAPE '!' OR h.address LIKE ? ESCAPE '!')`, [site, pattern, pattern])
        if (access.memberships)
          add('memberships', `SELECT 'memberships' section,'term' subtype,m.id,c.label,m.type_name detail
            FROM vc_crm_membership_terms m JOIN vc_crm_constituents c ON c.id=m.billing_contact_id
            WHERE m.site_id=? AND c.archived=0 AND (c.label LIKE ? ESCAPE '!' OR m.type_name LIKE ? ESCAPE '!')`, [site, pattern, pattern])
        if (access['restricted-activity']) {
          add('opportunities', `SELECT 'opportunities' section,'opportunity' subtype,o.id,o.name AS label,c.label detail
            FROM vc_crm_opportunities o JOIN vc_crm_constituents c ON c.id=o.constituent_id
            WHERE o.site_id=? AND o.archived=0 AND c.archived=0
            AND (o.name LIKE ? ESCAPE '!' OR c.label LIKE ? ESCAPE '!' OR o.next_action LIKE ? ESCAPE '!')`, [site, pattern, pattern, pattern])
          add('volunteers', `SELECT 'volunteers' section,'activity' subtype,v.id,v.name AS label,v.location detail
            FROM vc_crm_volunteer_activities v WHERE v.site_id=? AND v.archived=0
            AND (v.name LIKE ? ESCAPE '!' OR v.description LIKE ? ESCAPE '!' OR v.location LIKE ? ESCAPE '!')`, [site, pattern, pattern, pattern])
          if (access.communications)
            add('volunteers', `SELECT 'volunteers' section,'invitation' subtype,i.activity_id id,c.label,v.name detail
              FROM vc_crm_volunteer_invitations i JOIN vc_crm_volunteer_activities v ON v.id=i.activity_id
              JOIN vc_crm_constituents c ON c.id=i.constituent_id
              WHERE v.site_id=? AND v.archived=0 AND c.archived=0
              AND (c.label LIKE ? ESCAPE '!' OR v.name LIKE ? ESCAPE '!' OR i.notes LIKE ? ESCAPE '!')`, [site, pattern, pattern, pattern])
        }
        if (access['volunteer-experience'])
          add('volunteers', `SELECT 'volunteers' section,'profile' subtype,c.id,c.label,
            COALESCE(json_extract(v.skills,'$[0]'),'') detail
            FROM vc_crm_volunteer_profiles v JOIN vc_crm_constituents c ON c.id=v.constituent_id
            WHERE v.site_id=? AND v.archived=0 AND c.archived=0
            AND (c.label LIKE ? ESCAPE '!' OR v.skills LIKE ? ESCAPE '!' OR v.interests LIKE ? ESCAPE '!')`, [site, pattern, pattern, pattern])
        if (access['volunteer-hours'] && access['restricted-activity'])
          add('volunteers', `SELECT 'volunteers' section,'hours' subtype,h.id,c.label,v.name detail
            FROM vc_crm_volunteer_hours h JOIN vc_crm_volunteer_activities v ON v.id=h.activity_id
            JOIN vc_crm_constituents c ON c.id=h.constituent_id
            WHERE v.site_id=? AND v.archived=0 AND c.archived=0
            AND (c.label LIKE ? ESCAPE '!' OR v.name LIKE ? ESCAPE '!')`, [site, pattern, pattern])
        if (!branches.length) return Response.json({ docs: [], total: 0, page }, { headers: { 'Cache-Control': 'private, no-store' } })
        const union = branches.join(' UNION ALL ')
        const sql = suggest
          ? `WITH matches AS (${union}), ranked AS (SELECT *,row_number() OVER (PARTITION BY section ORDER BY label,id) rank FROM matches)
             SELECT section,subtype,id,label,detail FROM ranked WHERE rank<=3 ORDER BY section,label LIMIT 30`
          : `SELECT section,subtype,id,label,detail FROM (${union}) ORDER BY section,label,id LIMIT 25 OFFSET ?`
        const docs = (await db.prepare(sql).bind(...binds, ...(suggest ? [] : [(page - 1) * 25])).all<SearchRow>()).results
        const total = suggest ? docs.length : (await db.prepare(`SELECT count(*) total FROM (${union})`).bind(...binds).first<{ total: number }>())?.total || 0
        const epoch = await db.prepare('SELECT authority_revision FROM vc_organizations WHERE id=?').bind(identity.organization_id).first<{ authority_revision: number }>()
        if (epoch?.authority_revision !== identity.authorityRevision) throw new Error('This site access changed. Reload and try again.')
        return Response.json({ docs, total, page }, { headers: { 'Cache-Control': 'private, no-store' } })
      } catch (error) {
        return errorResponse(error)
      }
    },
  }]
}
