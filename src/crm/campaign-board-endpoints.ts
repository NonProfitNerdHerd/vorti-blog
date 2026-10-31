import type { Endpoint, PayloadRequest } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { OrganizationRepository } from '../organizations/repository'
import { claimRequest } from '../organizations/identity-authority'
import { cmsSiteContext } from '../organizations/cms-scope'
import { requireBoard, workspaceReq } from '../review/workspace-access'

async function context(req: PayloadRequest, db: D1Database, site: string, campaign: string, edit = false) {
  if (!req.user || req.user.collection !== 'users') throw new Error('Sign in to use CRM.')
  const authority = new OrganizationRepository(db, Number(req.user.id))
  await authority.require(site, 'finances', edit ? 'edit' : 'read')
  const record = await db.prepare('SELECT id,name,revision FROM vc_crm_campaigns WHERE site_id=? AND id=?')
    .bind(site, campaign).first<{ id: string; name: string; revision: number }>()
  if (!record) throw new Error('Campaign is unavailable.')
  req.context = { ...req.context, ...cmsSiteContext(site) }
  await claimRequest(req, site)
  return record
}

export function campaignBoardEndpoints(db: D1Database, errorResponse: (error: unknown) => Response): Endpoint[] {
  return [{
    path: '/crm/campaign-board', method: 'get', handler: async req => {
      try {
        const params = new URL(req.url!).searchParams
        const site = params.get('site') || '', campaign = params.get('campaign') || ''
        await context(req, db, site, campaign)
        const row = await db.prepare('SELECT board_id FROM vc_crm_campaign_boards WHERE site_id=? AND campaign_id=?')
          .bind(site, campaign).first<{ board_id: number }>()
        const available = await req.payload.find({ collection: 'task-boards', req, overrideAccess: false,
          depth: 0, limit: 100, where: { and: [{ platformSite: { equals: site } }, { archived: { not_equals: true } }] } })
        const boards: Array<{ id: number; name: string }> = []
        for (const board of available.docs) {
          try { await requireBoard(req, board.id, 'edit'); boards.push({ id: Number(board.id), name: board.name }) }
          catch { /* Board readers cannot link a campaign. */ }
        }
        let linked: { id: number; name: string } | null = null
        let linkedRestricted = false
        if (row) {
          try {
            await requireBoard(req, row.board_id)
            const board = await req.payload.findByID({ collection: 'task-boards', id: row.board_id, req: workspaceReq(req), overrideAccess: false, depth: 0 })
            linked = { id: Number(board.id), name: board.name }
          } catch { linkedRestricted = true }
        }
        return Response.json({ linked, linkedRestricted, boards }, { headers: { 'Cache-Control': 'private, no-store' } })
      } catch (error) { return errorResponse(error) }
    },
  }, {
    path: '/crm/campaign-board', method: 'post', handler: async req => {
      if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url!).origin)
        return Response.json({ message: 'Use the signed-in site to save changes.' }, { status: 403 })
      try {
        const body = await readBoundedJSON(req, 8000)
        const site = String(body.site || ''), campaign = String(body.campaign || '')
        const record = await context(req, db, site, campaign, true)
        if (Number(body.expectedRevision) !== record.revision) return Response.json({ message: 'Campaign changed. Reload and try again.' }, { status: 409 })
        if (body.action === 'unlink') {
          const current = await db.prepare('SELECT board_id FROM vc_crm_campaign_boards WHERE site_id=? AND campaign_id=?')
            .bind(site, campaign).first<{ board_id: number }>()
          if (current) await requireBoard(req, current.board_id, 'edit')
          await db.prepare('DELETE FROM vc_crm_campaign_boards WHERE site_id=? AND campaign_id=?').bind(site, campaign).run()
          return Response.json({ unlinked: true })
        }
        let boardID = Number(body.board)
        if (body.action === 'create') {
          const board = await req.payload.create({ collection: 'task-boards', req: workspaceReq(req), overrideAccess: false, depth: 0,
            data: { name: record.name, description: `Tasks for ${record.name}`, visibility: 'private', owner: Number(req.user!.id) } })
          boardID = Number(board.id)
        } else if (body.action !== 'link') throw new Error('Choose a board action.')
        if (!Number.isSafeInteger(boardID) || boardID < 1) throw new Error('Choose a board.')
        await requireBoard(req, boardID, 'edit')
        const board = await req.payload.findByID({ collection: 'task-boards', id: boardID, req: workspaceReq(req), overrideAccess: true, depth: 0 })
        if (board.platformSite !== site || board.archived) throw new Error('Choose an active board for this site.')
        const saved = await db.prepare(`INSERT INTO vc_crm_campaign_boards(campaign_id,site_id,board_id,created_at)
          SELECT id,site_id,?,? FROM vc_crm_campaigns WHERE id=? AND site_id=? AND revision=?
          ON CONFLICT(campaign_id) DO UPDATE SET board_id=excluded.board_id`)
          .bind(boardID, new Date().toISOString(), campaign, site, record.revision).run()
        if (!saved.meta.changes) return Response.json({ message: 'Campaign changed. Reload and try again.' }, { status: 409 })
        return Response.json({ board: { id: boardID, name: board.name } })
      } catch (error) { return errorResponse(error) }
    },
  }]
}
