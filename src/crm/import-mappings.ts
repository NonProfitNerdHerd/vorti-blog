import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import {
  importDomain,
  importDomains,
  importMapping,
  type ImportDomain,
  type ImportMapping,
} from './import-model'
import { commitCRM, replayCRM } from './mutations'

type MappingRow = {
  id: string
  site_id: string
  domain: ImportDomain
  name: string
  mapping_json: string
  revision: number
  archived: number
  created_by: number
  created_at: string
  updated_at: string
}
export type SavedImportMapping = Omit<MappingRow, 'mapping_json'> & { mapping: ImportMapping }
const visible = ({ mapping_json, ...row }: MappingRow): SavedImportMapping => {
  const mapping = importMapping(JSON.parse(mapping_json))
  if (mapping.domain !== row.domain) throw new Error('Stored import mapping context is invalid.')
  return { ...row, mapping }
}

/** Chapter-shared configuration. Source uploads and staged donor rows remain
 * owner-private in ImportFiles/ImportReviewRepository. Saving a mapping cannot
 * approve a run or write any imported domain record. */
export class ImportMappings {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async scope(site: string, domain: ImportDomain, edit = false) {
    const identity = await this.authority.require(site, 'identity', 'read')
    const categories = [
      importDomains[domain].category,
      ...(domain === 'volunteer-hours' ? ['restricted-activity' as const] : []),
    ]
    for (const category of categories) {
      if (
        (await this.authority.require(site, category, 'read')).authorityRevision !==
        identity.authorityRevision
      )
        throw new SiteAccessError()
      if (
        edit &&
        category === importDomains[domain].category &&
        (await this.authority.require(site, category, 'edit')).authorityRevision !==
          identity.authorityRevision
      )
        throw new SiteAccessError()
    }
    return identity
  }
  private async fence(site: string, epoch: number) {
    if ((await this.authority.require(site, 'identity', 'read')).authorityRevision !== epoch)
      throw new SiteAccessError()
  }
  async list(input: { site: string; domain: unknown; after?: string; archived?: boolean }) {
    const domain = importDomain(input.domain),
      scope = await this.scope(input.site, domain)
    if (input.after && (typeof input.after !== 'string' || input.after.length > 128))
      throw new Error('Invalid page cursor.')
    if (input.archived !== undefined && typeof input.archived !== 'boolean')
      throw new Error('Choose an archive filter.')
    const archived = input.archived ? 1 : 0
    const result = await this.db
      .prepare(
        `WITH matching AS (SELECT * FROM vc_crm_import_mappings WHERE site_id=? AND domain=? AND archived=?),
      page AS (SELECT * FROM matching WHERE id>? ORDER BY id LIMIT 51)
      SELECT (SELECT count(*) FROM matching) AS total,(SELECT json_group_array(json_object('id',id,'site_id',site_id,'domain',domain,'name',name,'mapping_json',mapping_json,'revision',revision,'archived',archived,'created_by',created_by,'created_at',created_at,'updated_at',updated_at)) FROM page) AS docs`,
      )
      .bind(input.site, domain, archived, input.after || '')
      .first<{ total: number; docs: string }>()
    if (!result) throw new Error('The mapping list could not be loaded.')
    const rows = JSON.parse(result.docs) as MappingRow[]
    const canEdit = (
      await this.authority.authority(input.site, importDomains[domain].category, 'edit')
    ).allowed
    await this.fence(input.site, scope.authorityRevision)
    return {
      docs: rows.slice(0, 50).map(visible),
      total: result.total,
      next: rows.length > 50 ? rows[49].id : null,
      canEdit,
    }
  }
  async get(site: string, rawDomain: unknown, id: string) {
    const domain = importDomain(rawDomain),
      scope = await this.scope(site, domain)
    const row = await this.db
      .prepare('SELECT * FROM vc_crm_import_mappings WHERE id=? AND site_id=? AND domain=?')
      .bind(id, site, domain)
      .first<MappingRow>()
    if (!row) throw new SiteAccessError()
    await this.fence(site, scope.authorityRevision)
    return visible(row)
  }
  async save(input: {
    site: string
    domain: unknown
    id?: string
    expectedRevision?: number
    name: unknown
    mapping: unknown
    archived: unknown
    operationKey: string
  }) {
    const domain = importDomain(input.domain),
      mapping = importMapping(input.mapping)
    if (mapping.domain !== domain) throw new Error('Choose a mapping for this import section.')
    if (
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.trim().length > 180 ||
      /[\u0000-\u001f\u007f]/.test(input.name)
    )
      throw new Error('Enter a mapping name of at most 180 characters.')
    if (typeof input.archived !== 'boolean')
      throw new Error('Choose an explicit mapping archive state.')
    if (
      input.id !== undefined &&
      (typeof input.id !== 'string' || !input.id || input.id.length > 128)
    )
      throw new Error('Choose a valid saved mapping.')
    if (
      input.id &&
      (input.expectedRevision === undefined ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 1)
    )
      throw new Error('Reload the current mapping revision before saving.')
    if (!input.id && input.expectedRevision !== undefined)
      throw new Error('Choose an existing mapping to update its revision.')
    const scope = await this.scope(input.site, domain, true),
      name = input.name.trim(),
      archived = input.archived ? 1 : 0
    const intent = {
        id: input.id ?? null,
        expectedRevision: input.expectedRevision ?? null,
        domain,
        name,
        mapping,
        archived,
      },
      action = 'import.mapping.saved'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'crm-import-mapping',
      intent,
    })
    if (replay) return replay
    const before = input.id
      ? await this.db
          .prepare('SELECT * FROM vc_crm_import_mappings WHERE id=? AND site_id=? AND domain=?')
          .bind(input.id, input.site, domain)
          .first<MappingRow>()
      : null
    if (input.id && !before) throw new SiteAccessError()
    if (before && before.revision !== input.expectedRevision) throw new SiteConflictError()
    const id = before?.id || crypto.randomUUID(),
      now = new Date().toISOString(),
      revision = (before?.revision || 0) + 1
    const write = before
      ? this.db
          .prepare(
            'UPDATE vc_crm_import_mappings SET name=?,mapping_json=?,archived=?,revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND domain=? AND revision=?',
          )
          .bind(
            name,
            JSON.stringify(mapping),
            archived,
            now,
            id,
            input.site,
            domain,
            before.revision,
          )
      : this.db
          .prepare(
            'INSERT INTO vc_crm_import_mappings(id,site_id,domain,name,mapping_json,archived,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            id,
            input.site,
            domain,
            name,
            JSON.stringify(mapping),
            archived,
            this.actor,
            now,
            now,
          )
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: scope.organization_id,
      authorityRevision: scope.authorityRevision,
      action,
      type: 'crm-import-mapping',
      id,
      before: before ? visible(before) : undefined,
      after: { name, mapping, archived, revision },
      intent,
      write,
      result: {
        id,
        revision,
        site_id: input.site,
        domain,
        name,
        mapping,
        archived,
        created_by: before?.created_by ?? this.actor,
        created_at: before?.created_at ?? now,
        updated_at: now,
      },
    })
  }
}
