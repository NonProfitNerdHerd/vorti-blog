import { audienceTablesV1 } from './audience-schema-v1'

const identifier = (value: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw Error('Unsupported publishing schema identifier.')
  return `"${value}"`
}

/** Prepare a complete native version without rewriting immutable legacy history.
 * The caller executes this plan inside the same revision-guarded D1 batch as its
 * record mutation. The operation key locates this version's auxiliary rows.
 */
export async function appendPublishingVersion(db: D1Database, input: {
  collection: string; id: number; key: string; now: string; actor: number; epoch: number;
  sourceVersion?: number | null; readership?: string; people?: number[]; groups?: string[]
  document?: { title: string; content: unknown; status: 'draft' | 'published' }
}): Promise<D1PreparedStatement[]> {
  const mapping = audienceTablesV1.find(([slug]) => slug === input.collection)
  if (!mapping) throw Error('Unsupported publishing collection.')
  if (!mapping[2]) return []
  const table = identifier(mapping[1]), versions = identifier(mapping[2])
  const [baseColumns, versionColumns] = await Promise.all([
    db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>(),
    db.prepare(`PRAGMA table_info(${versions})`).all<{ name: string }>(),
  ])
  const source = input.sourceVersion ? versions : table
  const base = new Set(baseColumns.results.map(column => column.name))
  const sourceID = input.sourceVersion || input.id
  const values: unknown[] = []
  const bind = (value: unknown) => { values.push(value); return '?' }
  const columns: string[] = [], expressions: string[] = []
  const overrides: Record<string, unknown> = {
    parent_id: input.id, created_at: input.now, updated_at: input.now, latest: 1,
    version_platform_write_actor: input.actor, version_platform_write_epoch: input.epoch,
    version_updated_at: input.now, version_publishing_operation_key: input.key,
    ...(input.readership ? { version_publishing_readership: input.readership, version_publishing_people: JSON.stringify(input.people || []), version_publishing_groups: JSON.stringify(input.groups || []) } : {}),
    ...(input.document ? { version_title: input.document.title, version_content: JSON.stringify(input.document.content), version__status: input.document.status } : {}),
  }
  for (const { name } of versionColumns.results) {
    if (name === 'id') continue
    if (Object.hasOwn(overrides, name)) { columns.push(identifier(name)); expressions.push(bind(overrides[name])); continue }
    const field = name.startsWith('version_') ? name.slice(8) : null
    if (input.sourceVersion || (field && base.has(field))) {
      columns.push(identifier(name))
      expressions.push(`s.${identifier(input.sourceVersion ? name : field!)}`)
    }
  }
  const statements = [
    db.prepare(`UPDATE ${versions} SET latest=0 WHERE parent_id=?`).bind(input.id),
    db.prepare(`INSERT INTO ${versions}(${columns.join(',')}) SELECT ${expressions.join(',')} FROM ${source} s WHERE s.id=?`).bind(...values, sourceID),
  ]
  const versionID = `(SELECT id FROM ${versions} WHERE parent_id=? AND latest=1 AND version_publishing_operation_key=? ORDER BY id DESC LIMIT 1)`
  if (input.collection === 'posts') {
    const origin = input.sourceVersion ? '_posts_v_rels' : 'posts_rels'
    statements.push(db.prepare(`INSERT INTO _posts_v_rels("order",parent_id,path,categories_id,tags_id)
      SELECT "order",${versionID},${input.sourceVersion ? 'path' : "'version.'||path"},categories_id,tags_id FROM ${identifier(origin)} WHERE parent_id=?`).bind(input.id, input.key, sourceID))
  }
  if (input.collection === 'pages') {
    const origin = input.sourceVersion ? '_pages_v_version_breadcrumbs' : 'pages_breadcrumbs'
    statements.push(db.prepare(`INSERT INTO _pages_v_version_breadcrumbs(_order,_parent_id,doc_id,url,label,_uuid)
      SELECT _order,${versionID},doc_id,url,${input.document ? 'CASE WHEN doc_id=? THEN ? ELSE label END' : 'label'},${input.sourceVersion ? '_uuid' : 'id'} FROM ${identifier(origin)} WHERE _parent_id=?`).bind(input.id, input.key, ...(input.document ? [input.id, input.document.title] : []), sourceID))
  }
  return statements
}
