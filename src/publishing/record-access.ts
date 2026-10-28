import { APIError, type PayloadRequest } from 'payload'
import { cmsDatabase } from '../organizations/cms-scope'
import { audienceTablesV1 } from './audience-schema-v1'
import { assertInternalReader, internalReaderAuthority } from './reader-policy'
import { readersView } from './readers-schema-v1'

/** Server-side inventory helper. Native queries use constant-size relationship
 * predicates directly; never pass this inventory as an IN list.
 */
export async function readableInternalIDs(req: PayloadRequest, collection: string, site: string): Promise<number[]> {
  if (!req.user) return []
  const table = audienceTablesV1.find(([slug]) => slug === collection)?.[1]
  if (!table) throw new APIError('Unsupported publishing collection.', 400)
  const scope = await internalReaderAuthority(req, site)
  const rows = await scope.repository.read({ site, permission: 'intranet:read', resource: `${collection}:readership-scope`, privateRecord: true, recordAccess: true },
    () => cmsDatabase(req).prepare(`SELECT record_id id FROM "${readersView(table)}" WHERE site=? AND actor=? AND audience='intranet' AND valid_structure=1${scope.authority.privateRead ? '' : ' AND ordinary_access=1'}${scope.history ? '' : ' AND published_tree=1'} ORDER BY record_id`)
      .bind(site, scope.actor).all<{ id: number }>())
  return rows.results.map(row => row.id)
}

export async function authorizeInternalRecord(req: PayloadRequest, collection: string, site: string, id: number) {
  await assertInternalReader(req, collection, site, id)
}
