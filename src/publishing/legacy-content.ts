import { validateKnowledgeBody } from '../knowledge/content'
import { canonicalJSON } from '../forms/acceptance'

export interface LegacyIntranetRow {
  id: string; tenant_id: string; site_id: string; kind: string; parent_id: string | null;
  title: string; slug: string; body: string; published_title: string | null; published_body: string | null;
  revision: number; deleted: number; creator_id: number; updated_at: string
}
export interface LegacyIntranetVersion {
  id: string; page_id: string; revision: number; title: string; body: string;
  actor_id: number; action: string; created_at: string
}
export const publishingDigest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON(value)))), byte => byte.toString(16).padStart(2, '0')).join('')

/** Preserve rich-text structure and formatting. Legacy links use Lexical's old
 * top-level URL; the shared editor uses Payload's fields-based link node.
 * Unknown nodes stop conversion rather than silently dropping their content.
 */
export async function convertLegacyBody(serialized: string) {
  const validated = validateKnowledgeBody(JSON.parse(serialized))
  const document = JSON.parse(validated.body) as { root: Record<string, unknown> }
  const seed = await publishingDigest(document)
  const visit = async (node: Record<string, unknown>, path: string): Promise<void> => {
    if (node.type === 'link') {
      const fields = node.fields && typeof node.fields === 'object' ? node.fields as Record<string, unknown> : {}
      node.fields = { linkType: 'custom', url: node.url ?? fields.url, newTab: fields.newTab === true || node.target === '_blank' }
      node.id = typeof node.id === 'string' && /^[a-f0-9]{24}$/.test(node.id) ? node.id : (await publishingDigest({ seed, path })).slice(0, 24)
      node.version = 3
    }
    if (Array.isArray(node.children)) for (const [index, child] of node.children.entries()) await visit(child as Record<string, unknown>, `${path}.${index}`)
  }
  await visit(document.root, 'root')
  return document
}

/** A deterministic parent-first order makes conversion restart-safe. */
export function orderLegacyIntranet(rows: LegacyIntranetRow[]) {
  const byID = new Map(rows.map(row => [row.id, row]))
  if (byID.size !== rows.length || rows.some(row => row.kind !== 'intranet')) throw Error('Legacy conversion requires unique Intranet records only.')
  const ordered: LegacyIntranetRow[] = [], visiting = new Set<string>(), heights = new Map<string, number>()
  const visit = (row: LegacyIntranetRow, depth: number): number => {
    if (visiting.has(row.id) || depth >= 64) throw Error('Legacy Intranet hierarchy contains a cycle or excessive depth.')
    if (heights.has(row.id)) return heights.get(row.id)!
    visiting.add(row.id)
    let height = 0
    if (row.parent_id) {
      const parent = byID.get(row.parent_id)
      if (!parent || parent.site_id !== row.site_id || parent.tenant_id !== row.tenant_id) throw Error('Legacy Intranet parent is missing or belongs to another scope.')
      height = visit(parent, depth + 1) + 1
    }
    if (height >= 64) throw Error('Legacy Intranet hierarchy contains excessive depth.')
    visiting.delete(row.id); heights.set(row.id, height); ordered.push(row)
    return height
  }
  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) visit(row, 0)
  return ordered
}

export async function prepareLegacyPage(row: LegacyIntranetRow, versions: LegacyIntranetVersion[]) {
  if (row.kind !== 'intranet' || !Number.isSafeInteger(row.creator_id) || row.creator_id < 1 || !['0', '1'].includes(String(row.deleted)) ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || !row.title || !row.slug || !Number.isFinite(Date.parse(row.updated_at))) throw Error('Unsupported legacy Intranet record; conversion stopped.')
  if ((row.published_body === null) !== (row.published_title === null)) throw Error('Legacy publication is incomplete; conversion stopped.')
  if (versions.some(version => version.page_id !== row.id || !Number.isSafeInteger(version.actor_id) || version.actor_id < 1 || version.revision > row.revision) || new Set(versions.map(version => version.revision)).size !== versions.length)
    throw Error('Legacy history does not match its source record; conversion stopped.')
  const draftContent = await convertLegacyBody(row.body)
  const publishedContent = row.published_body === null ? null : await convertLegacyBody(row.published_body)
  // Validate every immutable historical body even though it remains stored in
  // its original table and is exposed through the linked history interface.
  for (const version of versions) await convertLegacyBody(version.body)
  return { source: row, versions, owner: row.creator_id, archived: row.deleted === 1,
    title: row.published_title ?? row.title, content: publishedContent ?? draftContent,
    draftTitle: row.title, draftContent, status: publishedContent ? 'published' as const : 'draft' as const,
    hasUnpublishedChanges: row.published_body !== null && (row.title !== row.published_title || canonicalJSON(draftContent) !== canonicalJSON(publishedContent)),
    sourceHash: await publishingDigest({ row, versions: [...versions].sort((a, b) => a.revision - b.revision) }) }
}
