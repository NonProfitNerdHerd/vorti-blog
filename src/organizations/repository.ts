import { atomicSiteMutation, SiteConflictError } from './atomic'
import { decodeSiteCursor, encodeSiteCursor } from './site-cursor'
import { validateScopedSiteSettings, type ScopedSiteSettings } from './site-settings'
import {
  evaluateSiteAuthority,
  informationCategories,
  siteOperations,
  type AuthorityDecision,
  type InformationCategory,
  type PolicySnapshot,
  type SiteNode,
  type SiteOperation,
  type SiteRole,
} from './policy'

export class SiteAccessError extends Error {
  readonly status = 403
  constructor() {
    super('This site is unavailable or your access changed.')
  }
}
type SiteRow = {
  id: string
  organization_id: string
  parent_id: string | null
  archived: number
  revision: number
  name: string
  route_key: string
}
const toSite = (row: SiteRow): SiteNode => ({
  id: row.id,
  organization: row.organization_id,
  parent: row.parent_id,
  archived: row.archived === 1,
})
/** Five binds regardless of hierarchy width/depth; only relevant memberships and receivers enter the scope. */
const scopeSQL = `WITH RECURSIVE
  args(site,actor,organization,category,operation) AS(VALUES(?,?,?,?,?)),
  grants AS(SELECT g.* FROM vc_site_grants g JOIN args p ON g.source_id=p.site AND g.organization_id=p.organization AND (p.category IS NULL OR g.category=p.category) AND (p.operation IS NULL OR g.operation=p.operation) WHERE g.revoked=0),
  members AS(SELECT m.* FROM vc_site_memberships m JOIN vc_sites s ON s.id=m.site_id JOIN args p ON m.user_id=p.actor AND s.organization_id=p.organization WHERE m.active=1
    AND (EXISTS(SELECT 1 FROM vc_site_ancestry a WHERE a.ancestor_id=m.site_id AND a.descendant_id=p.site)
      OR EXISTS(SELECT 1 FROM grants g WHERE g.receiver_id=m.site_id OR(g.receiver_descendants=1 AND EXISTS(SELECT 1 FROM vc_site_ancestry a WHERE a.ancestor_id=g.receiver_id AND a.descendant_id=m.site_id))))),
  eligible_grants AS(SELECT g.* FROM grants g WHERE EXISTS(SELECT 1 FROM members m WHERE m.site_id=g.receiver_id OR(g.receiver_descendants=1 AND EXISTS(SELECT 1 FROM vc_site_ancestry a WHERE a.ancestor_id=g.receiver_id AND a.descendant_id=m.site_id)))),
  seeds(id) AS(SELECT site FROM args UNION SELECT site_id FROM members UNION SELECT receiver_id FROM eligible_grants),
  scope AS(SELECT s.id,s.organization_id,s.parent_id,s.archived,s.revision,s.name,s.route_key FROM vc_sites s JOIN seeds p ON s.id=p.id
    UNION SELECT s.id,s.organization_id,s.parent_id,s.archived,s.revision,s.name,s.route_key FROM vc_sites s JOIN scope p ON s.id=p.parent_id)`
const text = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum)
    throw new Error('Enter a valid value.')
  return value.trim()
}
async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
/** Construct with the authenticated account ID, never a body-supplied actor or operator flag. */
export class OrganizationRepository {
  constructor(
    private readonly db: D1Database,
    private readonly actor: number,
  ) {
    if (!Number.isSafeInteger(actor) || actor <= 0) throw new SiteAccessError()
  }
  async isOperator(): Promise<boolean> {
    return !!(await this.db
      .prepare(
        'SELECT user_id FROM vc_installation_operators WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=vc_installation_operators.user_id AND a.disabled=1)',
      )
      .bind(this.actor)
      .first())
  }
  /** Only authorized sites are returned; a context preference never creates a grant. */
  async listSites(after = ''): Promise<{ sites: SiteRow[]; next: string | null }> {
    const cursor = await decodeSiteCursor(after, this.actor)
    const operator = await this.isOperator()
    const rows = await this.db.prepare(`SELECT s.id,s.organization_id,s.parent_id,s.archived,s.revision,s.name,s.route_key FROM vc_sites s
      WHERE s.id>? AND (?=1 OR EXISTS(SELECT 1 FROM vc_site_memberships m JOIN vc_site_ancestry a ON a.ancestor_id=m.site_id
        WHERE m.user_id=? AND m.active=1 AND a.descendant_id=s.id)
      OR EXISTS(SELECT 1 FROM vc_site_grants g JOIN vc_site_memberships m ON m.user_id=? AND m.active=1
        WHERE g.source_id=s.id AND g.revoked=0 AND (g.receiver_id=m.site_id OR (g.receiver_descendants=1 AND EXISTS(
          SELECT 1 FROM vc_site_ancestry a WHERE a.ancestor_id=g.receiver_id AND a.descendant_id=m.site_id)))))
      ORDER BY s.id LIMIT 50`).bind(cursor, operator ? 1 : 0, this.actor, this.actor).all<SiteRow>()
    if (operator) {
      if (!(await this.isOperator())) throw new SiteAccessError()
      return { sites: rows.results, next: rows.results.length === 50 ? await encodeSiteCursor(rows.results.at(-1)!.id, this.actor) : null }
    }
    const sites: SiteRow[] = []
    const epochs = new Map<string, number>()
    for (const row of rows.results) {
      const authority = await this.authoritySet(row.id)
      const previous = epochs.get(row.organization_id)
      if (previous !== undefined && previous !== authority.authorityRevision) throw new SiteConflictError()
      epochs.set(row.organization_id, authority.authorityRevision)
      if (Object.values(authority.allowed).some(operations => operations.includes('read'))) sites.push(row)
    }
    for (const [organization, epoch] of epochs) {
      const current = await this.db.prepare('SELECT authority_revision FROM vc_organizations WHERE id=?').bind(organization).first<{ authority_revision: number }>()
      if (current?.authority_revision !== epoch) throw new SiteConflictError()
    }
    return { sites, next: rows.results.length === 50 ? await encodeSiteCursor(rows.results.at(-1)!.id, this.actor) : null }
  }
  async administration(siteID: string, memberAfter = 0, grantAfter = '') {
    const site = await this.require(siteID, 'identity', 'configure')
    const [members, policies, grants] = await Promise.all([
      this.db.prepare('SELECT user_id,role,active,revision FROM vc_site_memberships WHERE site_id=? AND user_id>? ORDER BY user_id LIMIT 101')
        .bind(siteID, memberAfter).all<{ user_id: number; role: SiteRole; active: number; revision: number }>(),
      this.db.prepare('SELECT category,operation,descendants_allowed,oversee_descendants,revision FROM vc_site_policies WHERE site_id=? ORDER BY category,operation')
        .bind(siteID).all(),
      this.db.prepare('SELECT id,receiver_id,receiver_descendants,category,operation,revoked,revision FROM vc_site_grants WHERE source_id=? AND id>? ORDER BY id LIMIT 101').bind(siteID, grantAfter).all<{ id: string }>(),
    ])
    const { decisions } = await this.authoritySet(siteID)
    const current = await this.site(siteID)
    const latest = await this.require(siteID, 'identity', 'configure')
    if (latest.authorityRevision !== site.authorityRevision) throw new SiteConflictError()
    return { site: current, members: members.results.slice(0, 100), memberNext: members.results.length > 100 ? members.results[99].user_id : null,
      policies: policies.results, grants: grants.results.slice(0, 100), grantNext: grants.results.length > 100 ? grants.results[99].id : null, decisions }
  }
  async memberRestrictions(siteID: string, user: number) {
    const site = await this.require(siteID, 'identity', 'configure')
    if (!Number.isSafeInteger(user) || user <= 0 || !await this.db.prepare('SELECT 1 FROM vc_site_memberships WHERE site_id=? AND user_id=?').bind(siteID, user).first())
      throw new SiteAccessError()
    const denied = (await this.db.prepare('SELECT category,operation FROM vc_member_restrictions WHERE site_id=? AND user_id=? ORDER BY category,operation').bind(siteID, user).all<{ category: InformationCategory; operation: SiteOperation }>()).results
    if ((await this.require(siteID, 'identity', 'configure')).authorityRevision !== site.authorityRevision) throw new SiteConflictError()
    return { denied, revision: site.revision }
  }
  async setContext(input: { site: string; expectedRevision: number; operationKey: string }) {
    const authority = await this.authoritySet(input.site)
    if (!Object.values(authority.allowed).some(operations => operations.includes('read'))) throw new SiteAccessError()
    const now = new Date().toISOString()
    return atomicSiteMutation(this.db, {
      actor: this.actor, operationKey: input.operationKey,
      fingerprint: await fingerprint({ action: 'context.set', ...input }),
      write: input.expectedRevision === 0
        ? this.db.prepare('INSERT INTO vc_site_contexts(user_id,site_id,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING').bind(this.actor, input.site, now)
        : this.db.prepare('UPDATE vc_site_contexts SET site_id=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?').bind(input.site, now, this.actor, input.expectedRevision),
      afterWrite: [...this.fence(input.operationKey, authority.site.organization_id, authority.authorityRevision),
        this.audit(input.operationKey, authority.site.organization_id, input.site, 'context.changed', 'context', String(this.actor), null, { site: input.site })],
      result: { site: input.site, revision: input.expectedRevision + 1 },
    })
  }
  async context() {
    return await this.db.prepare('SELECT site_id AS site,revision FROM vc_site_contexts WHERE user_id=?').bind(this.actor).first<{ site: string; revision: number }>() || { site: 'default', revision: 0 }
  }
  async settings(siteID: string) {
    const site = await this.require(siteID, 'content', 'read')
    if (siteID === 'default') throw new Error('Use the compatibility Site Settings workspace.')
    const row = await this.db.prepare('SELECT value,revision FROM vc_site_settings WHERE site_id=?')
      .bind(siteID).first<{ value: string; revision: number }>()
    if ((await this.require(siteID, 'content', 'read')).authorityRevision !== site.authorityRevision) throw new SiteConflictError()
    return { settings: row ? JSON.parse(row.value) as ScopedSiteSettings : { siteName: site.name, siteTagline: '', timezone: 'UTC' }, revision: row?.revision ?? 0 }
  }
  async setSettings(input: { site: string; expectedRevision: number; operationKey: string; settings: unknown }) {
    const site = await this.require(input.site, 'content', 'configure')
    if (input.site === 'default') throw new Error('Use the compatibility Site Settings workspace.')
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new SiteConflictError()
    const settings = validateScopedSiteSettings(input.settings), value = JSON.stringify(settings), now = new Date().toISOString()
    return atomicSiteMutation(this.db, {
      actor: this.actor, operationKey: input.operationKey,
      fingerprint: await fingerprint({ action: 'site.settings', ...input, settings }),
      write: input.expectedRevision === 0
        ? this.db.prepare('INSERT INTO vc_site_settings(site_id,value,updated_at) VALUES(?,?,?) ON CONFLICT(site_id) DO NOTHING').bind(input.site, value, now)
        : this.db.prepare('UPDATE vc_site_settings SET value=?,revision=revision+1,updated_at=? WHERE site_id=? AND revision=?').bind(value, now, input.site, input.expectedRevision),
      afterWrite: [...this.fence(input.operationKey, site.organization_id, site.authorityRevision),
        this.audit(input.operationKey, site.organization_id, input.site, 'site.settings-changed', 'site-settings', input.site, null, settings)],
      result: { site: input.site, settings, revision: input.expectedRevision + 1 },
    })
  }
  async setSharing(input: { site: string; receiver: string; category: InformationCategory; operation: SiteOperation;
    receiverDescendants: boolean; revoked: boolean; expectedRevision: number; operationKey: string }) {
    if (!informationCategories.includes(input.category) || !['read', 'edit'].includes(input.operation) ||
      typeof input.receiverDescendants !== 'boolean' || typeof input.revoked !== 'boolean' || input.site === input.receiver)
      throw new Error('Choose a valid sharing grant.')
    const source = await this.require(input.site, input.category, 'configure')
    const receiver = await this.require(input.receiver, input.category, 'configure')
    await this.require(input.site, input.category, input.operation)
    if (source.organization_id !== receiver.organization_id) throw new SiteAccessError()
    const id = `${input.site}:${input.receiver}:${input.category}:${input.operation}`, now = new Date().toISOString()
    return atomicSiteMutation(this.db, {
      actor: this.actor, operationKey: input.operationKey,
      fingerprint: await fingerprint({ action: 'sharing.set', ...input }),
      write: this.db.prepare('UPDATE vc_sites SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0').bind(now, source.id, input.expectedRevision),
      afterWrite: [...this.fence(input.operationKey, source.organization_id, source.authorityRevision),
        this.db.prepare(`INSERT INTO vc_site_grants(id,organization_id,source_id,receiver_id,receiver_descendants,category,operation,revoked,created_at)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET receiver_descendants=excluded.receiver_descendants,revoked=excluded.revoked,revision=vc_site_grants.revision+1`)
          .bind(id, source.organization_id, source.id, receiver.id, input.receiverDescendants ? 1 : 0, input.category, input.operation, input.revoked ? 1 : 0, now),
        this.audit(input.operationKey, source.organization_id, source.id, 'sharing.changed', 'grant', id, null, input)],
      result: { site: source.id, revision: input.expectedRevision + 1 },
    })
  }
  async moveSite(input: { site: string; parent: string; expectedRevision: number; expectedParentRevision: number; operationKey: string }) {
    const site = await this.require(input.site, 'identity', 'configure'),
      parent = await this.require(input.parent, 'identity', 'configure')
    if (!site.parent_id || site.organization_id !== parent.organization_id ||
      await this.db.prepare('SELECT 1 FROM vc_site_ancestry WHERE ancestor_id=? AND descendant_id=?').bind(site.id, parent.id).first())
      throw new Error('Choose a parent outside this site’s subtree in the same organization.')
    // Moving changes every category's inherited ceiling; identity administration alone is insufficient.
    for (const target of [site.id, parent.id]) {
      const authority = await this.authoritySet(target)
      if (informationCategories.some(category => siteOperations.some(operation => !authority.allowed[category]?.includes(operation))))
        throw new SiteAccessError()
    }
    const size = await this.db.prepare('SELECT count(*) AS n FROM vc_site_ancestry WHERE ancestor_id=?').bind(site.id).first<{ n: number }>()
    if (!size || size.n > 200) throw new Error('This move requires a durable hierarchy job; keep the current parent.')
    const now = new Date().toISOString()
    return atomicSiteMutation(this.db, {
      actor: this.actor, operationKey: input.operationKey,
      fingerprint: await fingerprint({ action: 'site.move', ...input }),
      write: this.db.prepare('UPDATE vc_sites SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0').bind(now, site.id, input.expectedRevision),
      afterWrite: [...this.fence(input.operationKey, site.organization_id, site.authorityRevision),
        this.db.prepare('UPDATE vc_sites SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0').bind(now, parent.id, input.expectedParentRevision),
        this.db.prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())').bind(`${input.operationKey}:parent`),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(`${input.operationKey}:parent`),
        this.db.prepare('UPDATE vc_sites SET parent_id=? WHERE id=?').bind(parent.id, site.id),
        this.db.prepare(`DELETE FROM vc_site_ancestry WHERE descendant_id IN(SELECT descendant_id FROM vc_site_ancestry WHERE ancestor_id=?)
          AND ancestor_id NOT IN(SELECT descendant_id FROM vc_site_ancestry WHERE ancestor_id=?)`).bind(site.id, site.id),
        this.db.prepare(`INSERT INTO vc_site_ancestry(ancestor_id,descendant_id,distance)
          SELECT a.ancestor_id,d.descendant_id,a.distance+d.distance+1 FROM vc_site_ancestry a CROSS JOIN vc_site_ancestry d
          WHERE a.descendant_id=? AND d.ancestor_id=?`).bind(parent.id, site.id),
        this.audit(input.operationKey, site.organization_id, site.id, 'site.moved', 'site', site.id, { parent: site.parent_id }, { parent: parent.id })],
      result: { site: site.id, revision: input.expectedRevision + 1 },
    })
  }
  private async site(id: string): Promise<SiteRow> {
    const site = await this.db
      .prepare(
        'SELECT id,organization_id,parent_id,archived,revision,name,route_key FROM vc_sites WHERE id=?',
      )
      .bind(id)
      .first<SiteRow>()
    if (!site) throw new SiteAccessError()
    return site
  }
  private async decision(
    site: string,
    category: InformationCategory,
    operation: SiteOperation,
  ): Promise<{ decision: AuthorityDecision; authorityRevision: number }> {
    const snapshot: PolicySnapshot = { sites: [], memberships: [], rules: [], grants: [] }
    const target = await this.site(site)
    const organization = target.organization_id
    const authority = await this.db
      .prepare(
        'SELECT authority_revision FROM vc_organizations WHERE id=? AND NOT EXISTS(SELECT 1 FROM vc_account_status WHERE user_id=? AND disabled=1)',
      )
      .bind(organization, this.actor)
      .first<{ authority_revision: number }>()
    if (!authority) throw new SiteAccessError()
    const parameters = [site, this.actor, organization, category, operation]
    // Keyset pages and joins avoid per-ancestor queries and accessible-ID IN lists.
    let cursor = ''
    while (true) {
      const page = await this.db
        .prepare(`${scopeSQL} SELECT * FROM scope WHERE id>? ORDER BY id LIMIT 100`)
        .bind(...parameters, cursor)
        .all<SiteRow>()
      snapshot.sites.push(...page.results.map(toSite))
      if (page.results.length < 100) break
      cursor = page.results.at(-1)!.id
    }
    cursor = ''
    while (true) {
      const page = await this.db
        .prepare(
          `${scopeSQL} SELECT m.site_id,m.role,EXISTS(SELECT 1 FROM vc_member_restrictions r JOIN args p ON r.category=p.category AND r.operation=p.operation WHERE r.site_id=m.site_id AND r.user_id=m.user_id) AS restricted,
            EXISTS(SELECT 1 FROM vc_member_capabilities c JOIN args p ON c.category=p.category AND c.operation=p.operation WHERE c.site_id=m.site_id AND c.user_id=m.user_id) AS granted
            FROM members m WHERE m.site_id>? ORDER BY m.site_id LIMIT 100`,
        )
        .bind(...parameters, cursor)
        .all<{ site_id: string; role: SiteRole; restricted: number; granted: number }>()
      snapshot.memberships.push(
        ...page.results.map((member) => ({
          user: String(this.actor),
          site: member.site_id,
          role: member.role,
          active: true,
          denied: member.restricted ? [{ category, operation }] : [],
          granted: member.granted ? [{ category, operation }] : [],
        })),
      )
      if (page.results.length < 100) break
      cursor = page.results.at(-1)!.site_id
    }
    cursor = ''
    while (true) {
      const page = await this.db
        .prepare(
          `${scopeSQL} SELECT id,organization_id,source_id,receiver_id,receiver_descendants FROM eligible_grants WHERE id>? ORDER BY id LIMIT 100`,
        )
        .bind(...parameters, cursor)
        .all<{
          id: string
          organization_id: string
          source_id: string
          receiver_id: string
          receiver_descendants: number
        }>()
      for (const grant of page.results) {
        snapshot.grants.push({
          organization: grant.organization_id,
          source: grant.source_id,
          receiver: grant.receiver_id,
          receiverDescendants: grant.receiver_descendants === 1,
          category,
          operations: [operation],
          revoked: false,
        })
      }
      if (page.results.length < 100) break
      cursor = page.results.at(-1)!.id
    }
    cursor = ''
    while (true) {
      const page = await this.db
        .prepare(
          `${scopeSQL} SELECT r.site_id,r.descendants_allowed,r.oversee_descendants FROM vc_site_policies r JOIN scope s ON s.id=r.site_id JOIN args p ON r.category=p.category AND r.operation=p.operation WHERE r.site_id>? ORDER BY r.site_id LIMIT 100`,
        )
        .bind(...parameters, cursor)
        .all<{ site_id: string; descendants_allowed: number; oversee_descendants: number }>()
      snapshot.rules.push(
        ...page.results.map((rule) => ({
          site: rule.site_id,
          category,
          operation,
          descendantsAllowed: rule.descendants_allowed === 1,
          overseeDescendants: rule.oversee_descendants === 1,
        })),
      )
      if (page.results.length < 100) break
      cursor = page.results.at(-1)!.site_id
    }
    const decision = evaluateSiteAuthority({
      snapshot,
      user: String(this.actor),
      installationOperator: await this.isOperator(),
      owningSite: site,
      category,
      operation,
    })
    const latest = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(organization)
      .first<{ authority_revision: number }>()
    if (latest?.authority_revision !== authority.authority_revision) throw new SiteAccessError()
    return { decision, authorityRevision: authority.authority_revision }
  }
  async authority(
    site: string,
    category: InformationCategory,
    operation: SiteOperation,
  ): Promise<AuthorityDecision> {
    return (await this.decision(site, category, operation)).decision
  }
  async require(
    site: string,
    category: InformationCategory,
    operation: SiteOperation,
  ): Promise<SiteRow & { authorityRevision: number }> {
    const { decision, authorityRevision } = await this.decision(site, category, operation)
    if (!decision.allowed) throw new SiteAccessError()
    return { ...(await this.site(site)), authorityRevision }
  }
  /** One joined, paginated snapshot evaluates the complete capability matrix. Used when issuing
   * request claims; do not perform fifty independent hierarchy queries during authentication. */
  async authoritySet(siteID: string): Promise<{
    site: SiteRow; authorityRevision: number; operator: boolean;
    allowed: Partial<Record<InformationCategory, SiteOperation[]>>
    decisions: Array<AuthorityDecision & { category: InformationCategory; operation: SiteOperation }>
  }> {
    const site = await this.site(siteID), root = site.organization_id
    const before = await this.db.prepare('SELECT authority_revision FROM vc_organizations WHERE id=? AND NOT EXISTS(SELECT 1 FROM vc_account_status WHERE user_id=? AND disabled=1)')
      .bind(root, this.actor).first<{ authority_revision: number }>()
    if (!before) throw new SiteAccessError()
    const snapshot: PolicySnapshot = { sites: [], memberships: [], rules: [], grants: [] }
    const parameters = [siteID, this.actor, root, null, null]
    const pages = async <T extends { cursor: string }>(query: string, consume: (row: T) => void): Promise<void> => {
      let cursor = ''
      for (;;) {
        const rows = (await this.db.prepare(`${scopeSQL} ${query}`).bind(...parameters, cursor).all<T>()).results
        for (const row of rows) consume(row)
        if (rows.length < 100) return
        cursor = rows.at(-1)!.cursor
      }
    }
    await pages<SiteRow & { cursor: string }>('SELECT *,id AS cursor FROM scope WHERE id>? ORDER BY id LIMIT 100', row => snapshot.sites.push(toSite(row)))
    const members = new Map<string, PolicySnapshot['memberships'][number]>()
    await pages<{ site_id: string; role: SiteRole; cursor: string }>('SELECT site_id,role,site_id AS cursor FROM members WHERE site_id>? ORDER BY site_id LIMIT 100', row => {
      const member: PolicySnapshot['memberships'][number] = { user: String(this.actor), site: row.site_id, role: row.role, active: true, denied: [], granted: [] }
      members.set(row.site_id, member); snapshot.memberships.push(member)
    })
    for (const [table, key] of [['vc_member_restrictions', 'denied'], ['vc_member_capabilities', 'granted']] as const) {
      const cursorSQL = "r.site_id||'|'||r.category||'|'||r.operation"
      await pages<{ site_id: string; category: InformationCategory; operation: SiteOperation; cursor: string }>(
        `SELECT r.site_id,r.category,r.operation,${cursorSQL} AS cursor FROM ${table} r JOIN members m ON m.site_id=r.site_id AND m.user_id=r.user_id WHERE ${cursorSQL}>? ORDER BY cursor LIMIT 100`,
        row => { members.get(row.site_id)?.[key]?.push({ category: row.category, operation: row.operation }) },
      )
    }
    const ruleCursor = "r.site_id||'|'||r.category||'|'||r.operation"
    await pages<{ site_id: string; category: InformationCategory; operation: SiteOperation; descendants_allowed: number; oversee_descendants: number; cursor: string }>(
      `SELECT r.*,${ruleCursor} AS cursor FROM vc_site_policies r JOIN scope s ON s.id=r.site_id WHERE ${ruleCursor}>? ORDER BY cursor LIMIT 100`,
      row => snapshot.rules.push({ site: row.site_id, category: row.category, operation: row.operation, descendantsAllowed: row.descendants_allowed === 1, overseeDescendants: row.oversee_descendants === 1 }),
    )
    await pages<{ id: string; source_id: string; receiver_id: string; receiver_descendants: number; category: InformationCategory; operation: SiteOperation; cursor: string }>(
      'SELECT *,id AS cursor FROM eligible_grants WHERE id>? ORDER BY id LIMIT 100',
      row => snapshot.grants.push({ organization: root, source: row.source_id, receiver: row.receiver_id, receiverDescendants: row.receiver_descendants === 1, category: row.category, operations: [row.operation], revoked: false }),
    )
    const operator = await this.isOperator(), allowed: Partial<Record<InformationCategory, SiteOperation[]>> = {}
    const decisions: Array<AuthorityDecision & { category: InformationCategory; operation: SiteOperation }> = []
    for (const category of informationCategories) for (const operation of siteOperations) {
      const decision = evaluateSiteAuthority({ snapshot, user: String(this.actor), installationOperator: operator, owningSite: siteID, category, operation })
      decisions.push({ category, operation, ...decision })
      if (decision.allowed)
        (allowed[category] ||= []).push(operation)
    }
    const after = await this.db.prepare('SELECT authority_revision FROM vc_organizations WHERE id=?').bind(root).first<{ authority_revision: number }>()
    if (after?.authority_revision !== before.authority_revision) throw new SiteAccessError()
    return { site, authorityRevision: before.authority_revision, operator, allowed, decisions }
  }
  async createOrganization(input: {
    name: string
    siteName: string
    operationKey: string
  }): Promise<Record<string, unknown>> {
    if (!(await this.isOperator())) throw new SiteAccessError()
    const name = text(input.name, 160),
      siteName = text(input.siteName, 160)
    const organization = crypto.randomUUID(),
      site = crypto.randomUUID(),
      now = new Date().toISOString()
    return atomicSiteMutation(this.db, {
      operationKey: input.operationKey,
      actor: this.actor,
      fingerprint: await fingerprint({ action: 'organization.create', name, siteName }),
      write: this.db
        .prepare('INSERT INTO vc_organizations(id,name,created_at,updated_at) VALUES(?,?,?,?)')
        .bind(organization, name, now, now),
      afterWrite: [
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_installation_operators o WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=o.user_id AND a.disabled=1)',
          )
          .bind(`${input.operationKey}:operator`, this.actor),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:operator`),
        this.db
          .prepare(
            'INSERT INTO vc_sites(id,organization_id,name,route_key,created_at,updated_at) VALUES(?,?,?,?,?,?)',
          )
          .bind(site, organization, siteName, site, now, now),
        this.db
          .prepare('INSERT INTO vc_site_ancestry(ancestor_id,descendant_id,distance) VALUES(?,?,0)')
          .bind(site, site),
        this.db
          .prepare(
            "INSERT INTO vc_site_memberships(site_id,user_id,role) VALUES(?,?,'administrator')",
          )
          .bind(site, this.actor),
        this.audit(
          input.operationKey,
          organization,
          site,
          'organization.created',
          'organization',
          organization,
          null,
          { name, siteName },
        ),
      ],
      result: { organization, site },
    })
  }
  async createSite(input: {
    parent: string
    expectedRevision: number
    name: string
    operationKey: string
  }): Promise<Record<string, unknown>> {
    const parent = await this.require(input.parent, 'identity', 'configure')
    // Creating a child provisions its administrator across all domains. Do not let a
    // restricted identity administrator regain finance access through a new child.
    const delegation = await this.authoritySet(parent.id)
    if (informationCategories.some(category => siteOperations.some(operation => !delegation.allowed[category]?.includes(operation))))
      throw new SiteAccessError()
    const name = text(input.name, 160),
      site = crypto.randomUUID(),
      now = new Date().toISOString()
    // Fence policy changes and parent archival inside this atomic unit.
    return atomicSiteMutation(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: await fingerprint({
        action: 'site.create',
        parent: parent.id,
        name,
        expectedRevision: input.expectedRevision,
      }),
      write: this.db
        .prepare(
          'UPDATE vc_sites SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0',
        )
        .bind(now, parent.id, input.expectedRevision),
      afterWrite: [
        ...this.fence(input.operationKey, parent.organization_id, parent.authorityRevision),
        this.db
          .prepare(
            'INSERT INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(site, parent.organization_id, parent.id, name, site, now, now),
        this.db
          .prepare(
            'INSERT INTO vc_site_ancestry(ancestor_id,descendant_id,distance) SELECT ancestor_id,?,distance+1 FROM vc_site_ancestry WHERE descendant_id=? UNION ALL SELECT ?,?,0',
          )
          .bind(site, parent.id, site, site),
        this.db
          .prepare(
            "INSERT INTO vc_site_memberships(site_id,user_id,role) VALUES(?,?,'administrator')",
          )
          .bind(site, this.actor),
        this.audit(
          input.operationKey,
          parent.organization_id,
          site,
          'site.created',
          'site',
          site,
          null,
          { name, parent: parent.id },
        ),
      ],
      result: { site, parent: parent.id },
    })
  }
  async setPolicy(input: {
    site: string
    category: InformationCategory
    operation: SiteOperation
    descendantsAllowed: boolean
    overseeDescendants: boolean
    expectedRevision: number
    operationKey: string
  }): Promise<Record<string, unknown>> {
    if (
      !informationCategories.includes(input.category) ||
      !siteOperations.includes(input.operation) ||
      typeof input.descendantsAllowed !== 'boolean' ||
      typeof input.overseeDescendants !== 'boolean'
    )
      throw new Error('Invalid policy.')
    const site = await this.require(input.site, input.category, 'configure')
    // Configuring a read rule cannot evade an ancestor's read ceiling.
    if (!(await this.authority(input.site, input.category, input.operation)).allowed)
      throw new SiteAccessError()
    const before = await this.db
      .prepare(
        'SELECT descendants_allowed,oversee_descendants FROM vc_site_policies WHERE site_id=? AND category=? AND operation=?',
      )
      .bind(site.id, input.category, input.operation)
      .first()
    const now = new Date().toISOString()
    return atomicSiteMutation(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: await fingerprint({ action: 'policy.set', ...input }),
      write: this.db
        .prepare(
          'UPDATE vc_sites SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0',
        )
        .bind(now, site.id, input.expectedRevision),
      afterWrite: [
        ...this.fence(input.operationKey, site.organization_id, site.authorityRevision),
        this.db
          .prepare(
            'INSERT INTO vc_site_policies(site_id,category,operation,descendants_allowed,oversee_descendants) VALUES(?,?,?,?,?) ON CONFLICT(site_id,category,operation) DO UPDATE SET descendants_allowed=excluded.descendants_allowed,oversee_descendants=excluded.oversee_descendants,revision=vc_site_policies.revision+1',
          )
          .bind(
            site.id,
            input.category,
            input.operation,
            input.descendantsAllowed ? 1 : 0,
            input.overseeDescendants ? 1 : 0,
          ),
        this.audit(
          input.operationKey,
          site.organization_id,
          site.id,
          'policy.changed',
          'policy',
          `${site.id}:${input.category}:${input.operation}`,
          before,
          {
            descendantsAllowed: input.descendantsAllowed,
            overseeDescendants: input.overseeDescendants,
          },
        ),
      ],
      result: { site: site.id, revision: input.expectedRevision + 1 },
    })
  }
  async setMembership(input: {
    site: string
    user: number
    role: SiteRole
    active: boolean
    expectedRevision: number
    operationKey: string
  }): Promise<Record<string, unknown>> {
    if (
      !['administrator', 'editor', 'reader'].includes(input.role) ||
      !Number.isSafeInteger(input.user) ||
      input.user <= 0 ||
      typeof input.active !== 'boolean'
    )
      throw new Error('Invalid membership.')
    const site = await this.require(input.site, 'identity', 'configure')
    if (!(await this.isOperator()) && !await this.db.prepare(`SELECT 1 FROM vc_site_memberships m JOIN vc_sites s ON s.id=m.site_id
      WHERE m.user_id=? AND m.active=1 AND s.organization_id=? LIMIT 1`).bind(input.user, site.organization_id).first())
      throw new SiteAccessError()
    const before = await this.db
      .prepare('SELECT role,active FROM vc_site_memberships WHERE site_id=? AND user_id=?')
      .bind(site.id, input.user)
      .first<{ role: SiteRole; active: number }>()
    const rank = { reader: 0, editor: 1, administrator: 2 }
    const expands =
      input.active && (!before || !before.active || rank[input.role] > rank[before.role])
    // Identity administration alone cannot delegate access to a protected finance or communications domain.
    if (expands && !(await this.isOperator())) {
      const operations: SiteOperation[] =
        input.role === 'administrator'
          ? [...siteOperations]
          : input.role === 'editor'
            ? ['read', 'edit']
            : ['read']
      for (const category of informationCategories) {
        await this.require(site.id, category, 'configure')
        for (const operation of operations) await this.require(site.id, category, operation)
      }
    }
    const reducingLastAdministrator =
      before?.role === 'administrator' &&
      before.active === 1 &&
      (!input.active || input.role !== 'administrator')
    const afterWrite = [
      ...this.fence(input.operationKey, site.organization_id, site.authorityRevision),
      this.db
        .prepare(
          'INSERT INTO vc_site_memberships(site_id,user_id,role,active) VALUES(?,?,?,?) ON CONFLICT(site_id,user_id) DO UPDATE SET role=excluded.role,active=excluded.active,revision=vc_site_memberships.revision+1',
        )
        .bind(site.id, input.user, input.role, input.active ? 1 : 0),
    ]
    if (reducingLastAdministrator)
      afterWrite.push(
        this.db
          .prepare(
            "INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM vc_site_memberships m WHERE m.site_id=? AND m.role='administrator' AND m.active=1 AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=m.user_id AND a.disabled=1)) THEN 1 ELSE 0 END",
          )
          .bind(`${input.operationKey}:administrator`, site.id),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:administrator`),
      )
    afterWrite.push(
      this.audit(
        input.operationKey,
        site.organization_id,
        site.id,
        'membership.changed',
        'membership',
        `${site.id}:${input.user}`,
        before,
        { role: input.role, active: input.active },
      ),
    )
    return atomicSiteMutation(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: await fingerprint({ action: 'membership.set', ...input }),
      write: this.db
        .prepare(
          'UPDATE vc_sites SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0',
        )
        .bind(new Date().toISOString(), site.id, input.expectedRevision),
      afterWrite,
      result: { site: site.id, user: input.user, revision: input.expectedRevision + 1 },
    })
  }
  /** Restrictions can only narrow a membership's role. Configure remains separately checked. */
  async setRestrictions(input: {
    site: string
    user: number
    denied: Array<{ category: InformationCategory; operation: SiteOperation }>
    expectedRevision: number
    operationKey: string
  }): Promise<Record<string, unknown>> {
    if (
      !Number.isSafeInteger(input.user) ||
      input.user < 1 ||
      !Array.isArray(input.denied) ||
      input.denied.length > informationCategories.length * siteOperations.length ||
      input.denied.some(
        (item) =>
          !informationCategories.includes(item.category) ||
          !siteOperations.includes(item.operation),
      )
    )
      throw new Error('Choose valid membership capabilities.')
    const denied = Array.from(
      new Map(input.denied.map((item) => [`${item.category}:${item.operation}`, item])).values(),
    ).sort((a, b) => `${a.category}:${a.operation}`.localeCompare(`${b.category}:${b.operation}`))
    const site = await this.require(input.site, 'identity', 'configure')
    const member = await this.db
      .prepare('SELECT role,active FROM vc_site_memberships WHERE site_id=? AND user_id=?')
      .bind(site.id, input.user)
      .first<{ role: SiteRole; active: number }>()
    if (!member) throw new SiteAccessError()
    // A scoped administrator cannot lock out administration, including through capability denial.
    if (
      member.role === 'administrator' &&
      denied.some((item) => item.category === 'identity' && item.operation === 'configure')
    )
      throw new Error('Use the membership role to change site administration.')
    const before = (
      await this.db
        .prepare(
          'SELECT category,operation FROM vc_member_restrictions WHERE site_id=? AND user_id=? ORDER BY category,operation',
        )
        .bind(site.id, input.user)
        .all<{ category: InformationCategory; operation: SiteOperation }>()
    ).results
    if (!(await this.isOperator())) {
      const changed = [...before, ...denied].filter(
        (item) =>
          before.some(
            (old) => old.category === item.category && old.operation === item.operation,
          ) !==
          denied.some(
            (next) => next.category === item.category && next.operation === item.operation,
          ),
      )
      for (const category of new Set(changed.map((item) => item.category)))
        await this.require(site.id, category, 'configure')
      for (const removed of before.filter(
        (item) =>
          !denied.some(
            (next) => next.category === item.category && next.operation === item.operation,
          ),
      ))
        await this.require(site.id, removed.category, removed.operation)
    }
    return atomicSiteMutation(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: await fingerprint({
        action: 'membership.restrict',
        site: site.id,
        user: input.user,
        denied,
        revision: input.expectedRevision,
      }),
      write: this.db
        .prepare(
          'UPDATE vc_sites SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0',
        )
        .bind(new Date().toISOString(), site.id, input.expectedRevision),
      afterWrite: [
        ...this.fence(input.operationKey, site.organization_id, site.authorityRevision),
        this.db
          .prepare('DELETE FROM vc_member_restrictions WHERE site_id=? AND user_id=?')
          .bind(site.id, input.user),
        ...denied.map((item) =>
          this.db
            .prepare(
              'INSERT INTO vc_member_restrictions(site_id,user_id,category,operation) VALUES(?,?,?,?)',
            )
            .bind(site.id, input.user, item.category, item.operation),
        ),
        this.audit(
          input.operationKey,
          site.organization_id,
          site.id,
          'membership.capabilities-changed',
          'membership',
          `${site.id}:${input.user}`,
          before,
          denied,
        ),
      ],
      result: { site: site.id, user: input.user, revision: input.expectedRevision + 1 },
    })
  }
  /** Deactivation retains authorship, credentials and immutable history. Only operators manage accounts. */
  async setAccountStatus(input: {
    user: number
    disabled: boolean
    expectedRevision: number
    reason: string
    operationKey: string
  }): Promise<Record<string, unknown>> {
    if (!(await this.isOperator())) throw new SiteAccessError()
    if (!Number.isSafeInteger(input.user) || input.user < 1 || typeof input.disabled !== 'boolean')
      throw new Error('Choose a valid account.')
    const reason = text(input.reason, 2000)
    const before = await this.db
      .prepare('SELECT disabled,revision FROM vc_account_status WHERE user_id=?')
      .bind(input.user)
      .first()
    const now = new Date().toISOString()
    return atomicSiteMutation(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: await fingerprint({ action: 'account.status', ...input, reason }),
      write:
        input.expectedRevision === 0
          ? this.db
              .prepare(
                'INSERT INTO vc_account_status(user_id,disabled,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING',
              )
              .bind(input.user, input.disabled ? 1 : 0, now)
          : this.db
              .prepare(
                'UPDATE vc_account_status SET disabled=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?',
              )
              .bind(input.disabled ? 1 : 0, now, input.user, input.expectedRevision),
      afterWrite: [
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM vc_installation_operators o WHERE o.user_id=? AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=o.user_id AND a.disabled=1)) THEN 1 ELSE 0 END',
          )
          .bind(`${input.operationKey}:operator`, this.actor),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:operator`),
        this.db
          .prepare(
            `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN NOT EXISTS(
          SELECT 1 FROM vc_site_memberships m WHERE m.user_id=? AND m.active=1 AND m.role='administrator'
          AND NOT EXISTS(SELECT 1 FROM vc_site_memberships other WHERE other.site_id=m.site_id AND other.active=1 AND other.role='administrator'
            AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=other.user_id AND a.disabled=1))) THEN 1 ELSE 0 END`,
          )
          .bind(`${input.operationKey}:site-admin`, input.user),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:site-admin`),
        this.db
          .prepare(
            'INSERT INTO vc_platform_audit(id,actor_id,action,record_type,record_id,before_value,after_value,reason,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            this.actor,
            'account.status-changed',
            'user',
            String(input.user),
            before ? JSON.stringify(before) : null,
            JSON.stringify({ disabled: input.disabled }),
            reason,
            input.operationKey,
            now,
          ),
      ],
      result: { user: input.user, disabled: input.disabled, revision: input.expectedRevision + 1 },
    })
  }
  /** Every policy/membership/sharing mutation must advance the organization's authority revision. */
  private fence(key: string, organization: string, revision: number): D1PreparedStatement[] {
    return [
      this.db
        .prepare(
          'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
        )
        .bind(`${key}:authority`, organization, revision),
      this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(`${key}:authority`),
    ]
  }
  private audit(
    key: string,
    organization: string,
    site: string,
    action: string,
    type: string,
    id: string,
    before: unknown,
    after: unknown,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,before_value,after_value,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        crypto.randomUUID(),
        organization,
        site,
        this.actor,
        action,
        type,
        id,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        key,
        new Date().toISOString(),
      )
  }
}
