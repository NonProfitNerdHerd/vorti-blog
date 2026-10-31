import { APIError, type PayloadRequest } from 'payload'
import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { CRMRecordAccess } from './record-access'
import { crmRecordLink, type CRMRecordLink } from './record-model'
import { crmTaskRecordExistsV3 } from './task-context-v3'
import { crmTaskRecordExistsV2 } from './task-context-v2'
import { crmRecordRulesV2 } from './record-context-v2'
import { workspaceDB, workspaceReq, requireTask, ids } from '../review/workspace-access'
import { relationID } from '../review/documents'
import type { InformationCategory } from '../organizations/policy'

export const crmTaskWrite = Symbol.for('vorticause.server-crm-task-write')
export const crmTaskKeys = [
  'crmSite',
  'crmType',
  'crmID',
  'crmActivityID',
  'crmOperationKey',
  'crmIntentHash',
  'crmRecordRevision',
  'crmAuthorityRevision',
] as const
export type LinkedCRMTask = Record<string, unknown> & {
  crmSite?: string | null
  crmType?: string | null
  crmID?: string | null
  crmActivityID?: string | null
}
export async function crmTaskIntentHash(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** Assignees must be able to work the follow-up; ordinary viewers need read
 * access. All record checks are live and independent of native Task ownership. */
export async function authorizeCRMTaskActor(
  db: D1Database,
  actor: number,
  siteID: string,
  link: CRMRecordLink,
  operation: 'read' | 'edit' = 'read',
) {
  const authority = new OrganizationRepository(db, actor),
    resolved = await new CRMRecordAccess(db, actor).resolve(siteID, link),
    epoch = resolved.site.authorityRevision
  const operations: Array<[InformationCategory, 'read' | 'edit']> = [['workspace', 'read']]
  if (operation === 'edit') operations.push(['workspace', 'edit'], [resolved.category, 'edit'])
  for (const [category, action] of operations) {
    if ((await authority.require(siteID, category, action)).authorityRevision !== epoch)
      throw new SiteAccessError()
  }
  const current = await db
    .prepare(
      `WITH link AS(SELECT ? AS site,? AS type,? AS id) SELECT 1 FROM link JOIN vc_sites s ON s.id=link.site JOIN vc_organizations o ON o.id=s.organization_id WHERE o.authority_revision=? AND (${Object.hasOwn(crmRecordRulesV2, link.type) ? crmTaskRecordExistsV2('link.site', 'link.type', 'link.id') : crmTaskRecordExistsV3('link.site', 'link.type', 'link.id')})`,
    )
    .bind(siteID, link.type, link.id, epoch)
    .first()
  if (!current) throw new SiteAccessError()
  return resolved
}

/** Only the CRM creation endpoint may establish a primary reference. Native
 * child Tasks inherit it; subsequent edits retain the original reference. */
export async function validateCRMTaskChange(
  req: PayloadRequest,
  data: LinkedCRMTask,
  original: LinkedCRMTask | undefined,
  operation: 'create' | 'update',
  establish = true,
) {
  if (!req.user) throw new SiteAccessError()
  if (operation === 'update')
    for (const key of crmTaskKeys)
      if (key in data && (data[key] ?? null) !== (original?.[key] ?? null))
        throw new APIError('CRM task references and retry keys cannot be changed.', 403)
  if (operation === 'create' && establish) {
    const supplied = crmTaskKeys.some((key) => data[key] != null)
    const parentID = relationID(data.parent)
    if (parentID) {
      const parent = (await requireTask(req, parentID, 'edit')) as unknown as LinkedCRMTask
      if (supplied) throw new APIError('Subtasks inherit their CRM reference.', 403)
      if (parent.crmType) {
        for (const key of ['crmSite', 'crmType', 'crmID', 'crmActivityID'] as const)
          data[key] = parent[key]
        data.crmOperationKey = crypto.randomUUID()
        data.crmIntentHash = await crmTaskIntentHash({
          parent: parentID,
          actor: req.user.id,
          title: data.title,
          link: [parent.crmSite, parent.crmType, parent.crmID],
        })
      }
    } else if (supplied && !(req.context as Record<symbol, unknown>)[crmTaskWrite])
      throw new APIError('Create linked follow-ups from their CRM record.', 403)
  }
  const next = { ...original, ...data }
  if (!next.crmType) {
    if (crmTaskKeys.some((key) => next[key] != null))
      throw new APIError('Choose a complete CRM task reference.', 400)
    return data
  }
  const link = crmRecordLink(next.crmType, next.crmID),
    site = String(next.crmSite || ''),
    db = workspaceDB(req)
  if (!site || site.length > 80) throw new SiteAccessError()
  const access = await authorizeCRMTaskActor(db, Number(req.user.id), site, link, 'edit')
  if (operation === 'create') {
    if (data.parent && establish) {
      data.crmRecordRevision = access.record.revision
      data.crmAuthorityRevision = access.site.authorityRevision
    }
    if (
      next.crmRecordRevision !== access.record.revision ||
      next.crmAuthorityRevision !== access.site.authorityRevision
    ) {
      if (!(data.parent && establish))
        throw new APIError(
          'This record or its permissions changed. Refresh before creating the follow-up.',
          409,
        )
    }
  }
  data.documentSite = site
  if (next.documentType && next.documentType !== 'none')
    throw new APIError('CRM follow-ups use their retained CRM record reference.', 400)
  if (next.crmActivityID) {
    if (
      link.type !== 'contact' ||
      !(await db
        .prepare('SELECT 1 FROM vc_crm_activities WHERE id=? AND site_id=? AND constituent_id=?')
        .bind(String(next.crmActivityID), site, link.id)
        .first())
    )
      throw new SiteAccessError()
  }
  const people = new Set<string>()
  if (next.assignee) people.add(relationID(next.assignee))
  for (const person of ids(next.collaborators)) people.add(person)
  for (const person of people) {
    if (
      operation === 'update' &&
      person === relationID(next.assignee) &&
      person === relationID(original?.assignee)
    )
      continue
    if (
      operation === 'update' &&
      person !== relationID(next.assignee) &&
      ids(original?.collaborators).includes(person)
    )
      continue
    await authorizeCRMTaskActor(
      db,
      Number(person),
      site,
      link,
      person === relationID(next.assignee) ? 'edit' : 'read',
    )
  }
  for (const boardID of new Set([
    ...ids(next.boards),
    ...(next.initialBoard ? [relationID(next.initialBoard)] : []),
  ])) {
    const board = await req.payload.findByID({
      collection: 'task-boards',
      id: boardID,
      req: workspaceReq(req),
      overrideAccess: true,
      depth: 0,
    })
    if (board.platformSite !== site)
      throw new APIError('Choose a board in this CRM record’s chapter.', 403)
  }
  return data
}
