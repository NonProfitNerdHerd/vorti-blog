import { audienceTablesV1 } from './audience-schema-v1'

export const readersView = (table: string) => `vc_pub_${table}_readers`
export const readersSlug = (collection: string) => `publishing-${collection}-readers`

/** Live SQL views keep native access predicates constant-size. Membership and
 * ancestor changes take effect without materializing or caching reader grants.
 */
export function publishingReadersViewSQL([slug, table, versions]: readonly [string, string, string | null]): string[] {
  const view = readersView(table), own = `${view}_own`
  const parent = slug === 'pages' ? 'parent_id' : 'NULL'
  const status = versions ? '_status' : "'published'"
  const archived = slug === 'pages' ? 'p.publishing_archived' : '0'
  const valid = `MAX(CASE WHEN site<>root_site OR audience<>root_audience OR archived=1 OR depth>=64
    OR (parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "${table}" p WHERE p.id=a.parent_id AND instr(a.path,','||p.id||',')=0)) THEN 1 ELSE 0 END)=0`
  const ancestry = `WITH RECURSIVE ancestry(root,id,parent_id,site,audience,readership,owner,people,groups,status,archived,path,depth,root_site,root_audience,tenant) AS(
    SELECT p.id,p.id,${parent === 'NULL' ? parent : 'p.' + parent},p.platform_site,p.audience,p.publishing_readership,p.publishing_owner,p.publishing_people,p.publishing_groups,${versions ? 'p.' + status : status},${archived},','||p.id||',',0,p.platform_site,p.audience,s.organization_id
    FROM "${table}" p JOIN vc_sites s ON s.id=p.platform_site
    UNION ALL SELECT a.root,p.id,p.${slug === 'pages' ? 'parent_id' : 'id'},p.platform_site,p.audience,p.publishing_readership,p.publishing_owner,p.publishing_people,p.publishing_groups,${versions ? 'p.' + status : status},${archived},a.path||p.id||',',a.depth+1,a.root_site,a.root_audience,a.tenant
    FROM ancestry a JOIN "${table}" p ON p.id=a.parent_id WHERE a.depth<64 AND instr(a.path,','||p.id||',')=0)
    SELECT printf('%d:%d',a.root,m.user_id) id,a.root record_id,CAST(m.user_id AS INTEGER) actor,a.root_site site,a.root_audience audience,
      ${valid} valid_structure,MIN(CASE WHEN a.status='published' THEN 1 ELSE 0 END) published_tree,
      MIN(CASE WHEN readership='site' OR owner=m.user_id OR EXISTS(SELECT 1 FROM json_each(people) WHERE value=m.user_id)
        OR EXISTS(SELECT 1 FROM json_each(groups) recipient JOIN vc_publishing_groups g ON g.id=recipient.value
          JOIN vc_publishing_group_members membership ON membership.group_id=g.id
          WHERE g.retired=0 AND g.site_id=a.root_site AND g.tenant_id=a.tenant AND membership.user_id=m.user_id)
        THEN 1 ELSE 0 END) ordinary_access${versions ? `,(SELECT p.publishing_published_at FROM "${table}" p WHERE p.id=a.root) published_at_marker,(SELECT p.publishing_identity FROM "${table}" p WHERE p.id=a.root) identity_marker` : ''}
    FROM ancestry a JOIN vc_tenant_memberships m ON m.tenant_id=a.tenant AND m.active=1
    WHERE a.root_audience='intranet' AND NOT EXISTS(SELECT 1 FROM vc_account_status disabled WHERE disabled.user_id=m.user_id AND disabled.disabled=1)
    GROUP BY a.root,m.user_id
    UNION ALL SELECT printf('%d:0',a.root),a.root,CAST(0 AS INTEGER),a.root_site,a.root_audience,${valid},MIN(CASE WHEN a.status='published' THEN 1 ELSE 0 END),1${versions ? `,(SELECT p.publishing_published_at FROM "${table}" p WHERE p.id=a.root),(SELECT p.publishing_identity FROM "${table}" p WHERE p.id=a.root)` : ''}
    FROM ancestry a WHERE a.root_audience='public' GROUP BY a.root`
  const statements = [`DROP VIEW IF EXISTS "${view}"`, `DROP VIEW IF EXISTS "${own}"`, `CREATE VIEW "${own}" AS ${ancestry}`]
  if (slug === 'media') {
    const none = '(m.publishing_source_collection IS NULL AND m.publishing_source_i_d IS NULL)'
    const value = (alias: string, name: string) => `${alias}.${name}${name === 'published_tree' ? ` AND (m.publishing_requires_publication=0 OR ${alias}.published_at_marker>=m.created_at)` : ''}`
    const flag = (name: string) => `CASE WHEN ${none} THEN 1
      WHEN m.publishing_source_collection='posts' AND p.site=o.site AND p.audience=o.audience THEN ${value('p', name)}
      WHEN m.publishing_source_collection='pages' AND q.site=o.site AND q.audience=o.audience THEN ${value('q', name)}
      WHEN m.publishing_source_collection='posts' AND hp.site=o.site AND hp.audience=o.audience THEN ${value('hp', name)}
      WHEN m.publishing_source_collection='pages' AND hq.site=o.site AND hq.audience=o.audience THEN ${value('hq', name)} ELSE 0 END`
    statements.push(`CREATE VIEW "${view}" AS SELECT o.id,o.record_id,o.actor,o.site,o.audience,
      (o.valid_structure AND ${flag('valid_structure')}) valid_structure,(o.published_tree AND ${flag('published_tree')}) published_tree,
      (o.ordinary_access AND ${flag('ordinary_access')}) ordinary_access FROM "${own}" o JOIN media m ON m.id=o.record_id
      LEFT JOIN "${readersView('posts')}" p ON p.record_id=m.publishing_source_i_d AND p.identity_marker=m.publishing_source_identity AND p.actor=o.actor AND m.publishing_source_collection='posts'
      LEFT JOIN "${readersView('pages')}" q ON q.record_id=m.publishing_source_i_d AND q.identity_marker=m.publishing_source_identity AND q.actor=o.actor AND m.publishing_source_collection='pages'
      LEFT JOIN "${readersView('vc_publishing_history_posts')}" hp ON hp.record_id=m.publishing_source_i_d AND hp.identity_marker=m.publishing_source_identity AND hp.actor=o.actor AND m.publishing_source_collection='posts'
      LEFT JOIN "${readersView('vc_publishing_history_pages')}" hq ON hq.record_id=m.publishing_source_i_d AND hq.identity_marker=m.publishing_source_identity AND hq.actor=o.actor AND m.publishing_source_collection='pages'`)
  } else if (slug === 'event-series') {
    statements.push(`CREATE VIEW "${view}" AS SELECT o.id,o.record_id,o.actor,o.site,o.audience,
      (o.valid_structure AND COALESCE(p.valid_structure,0) AND p.site=o.site AND p.audience=o.audience) valid_structure,
      (o.published_tree AND COALESCE(p.published_tree,0)) published_tree,(o.ordinary_access AND COALESCE(p.ordinary_access,0)) ordinary_access
      FROM "${own}" o JOIN event_series e ON e.id=o.record_id LEFT JOIN "${readersView('posts')}" p ON p.record_id=e.post_id AND p.actor=o.actor`)
  } else if (slug === 'search') {
    const flag = (name: string) => `CASE WHEN r.posts_id IS NOT NULL AND r.pages_id IS NULL AND p.site=o.site AND p.audience=o.audience THEN p.${name}
      WHEN r.pages_id IS NOT NULL AND r.posts_id IS NULL AND q.site=o.site AND q.audience=o.audience THEN q.${name} ELSE 0 END`
    statements.push(`CREATE VIEW "${view}" AS SELECT o.id,o.record_id,o.actor,o.site,o.audience,
      (o.valid_structure AND ${flag('valid_structure')} AND (SELECT COUNT(*) FROM search_rels x WHERE x.parent_id=o.record_id AND x.path='doc')=1) valid_structure,
      (o.published_tree AND ${flag('published_tree')}) published_tree,(o.ordinary_access AND ${flag('ordinary_access')}) ordinary_access,
      CASE WHEN r.posts_id IS NOT NULL AND r.pages_id IS NULL THEN 'posts' WHEN r.pages_id IS NOT NULL AND r.posts_id IS NULL THEN 'pages' ELSE NULL END source_collection
      FROM "${own}" o LEFT JOIN search_rels r ON r.parent_id=o.record_id AND r.path='doc'
      LEFT JOIN "${readersView('posts')}" p ON p.record_id=r.posts_id AND p.actor=o.actor
      LEFT JOIN "${readersView('pages')}" q ON q.record_id=r.pages_id AND q.actor=o.actor`)
  } else if (versions) {
    statements.push(`CREATE VIEW "${view}" AS SELECT o.*,
      (p._status='published' AND COALESCE((SELECT v.version__status FROM "${versions}" v WHERE v.parent_id=p.id ORDER BY v.latest DESC,v.id DESC LIMIT 1),'published')='published') draft_free
      FROM "${own}" o JOIN "${table}" p ON p.id=o.record_id`)
  } else statements.push(`CREATE VIEW "${view}" AS SELECT * FROM "${own}"`)
  return statements
}

export const publishingReadersSchemaV1 = () => [
  ...audienceTablesV1.flatMap(publishingReadersViewSQL),
  ...(['posts', 'pages'] as const).flatMap(collection => {
    const table = `vc_publishing_history_${collection}`
    const choose = (current: string, archived: string) => `CASE WHEN p.audience='intranet' THEN p.${current} ELSE h.${archived} END`
    return [`DROP VIEW IF EXISTS "${table}"`, `CREATE VIEW "${table}" AS SELECT p.id,
      ${collection === 'pages' ? choose('parent_id', 'parent_id') : 'NULL'} parent_id,p.platform_site,'intranet' audience,
      ${choose('publishing_readership', 'readership')} publishing_readership,${choose('publishing_owner', 'owner_id')} publishing_owner,
      ${choose('publishing_people', 'people')} publishing_people,${choose('publishing_groups', 'groups')} publishing_groups,
      CASE WHEN p.audience='intranet' THEN p._status WHEN h.published=1 THEN 'published' ELSE 'draft' END _status,
      CASE WHEN ${collection === 'pages' ? 'p.publishing_archived=1 OR' : ''}
        (p.audience='public' AND h.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pages parent WHERE parent.id=h.parent_id AND parent.created_at=h.parent_created_at AND parent.publishing_identity=h.parent_identity)) THEN 1 ELSE 0 END publishing_archived,
      ${choose('publishing_published_at', 'published_at')} publishing_published_at,p.publishing_identity,p.created_at
      FROM "${collection}" p LEFT JOIN vc_publishing_private_history h ON h.collection='${collection}' AND h.document_id=p.id AND h.site_id=p.platform_site AND h.document_created_at=p.created_at AND h.document_identity=p.publishing_identity
      WHERE p.audience='intranet' OR (p.audience='public' AND h.document_id IS NOT NULL AND h.tenant_id=(SELECT organization_id FROM vc_sites WHERE id=p.platform_site))`,
      ...publishingReadersViewSQL([collection, table, `_${collection}_v`])]
  }),
  `DROP VIEW IF EXISTS "${readersView('review_document')}"`,
  `CREATE VIEW "${readersView('review_document')}" AS ${(['posts', 'pages', 'site-templates'] as const).map(collection => {
    const table = collection === 'site-templates' ? 'site_tpl' : collection
    return `SELECT printf('%d:%d',t.id,p.actor) id,t.id record_id,p.actor,p.site,p.audience,p.valid_structure,p.published_tree,p.ordinary_access,'${collection}' source_collection
      FROM review_tasks t JOIN "${readersView(table)}" p ON p.record_id=CAST(t.document_i_d AS INTEGER) AND p.site=t.document_site WHERE t.document_type='${collection}'`
  }).join(' UNION ALL ')}`,
]
