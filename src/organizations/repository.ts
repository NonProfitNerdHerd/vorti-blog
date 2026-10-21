import { atomicSiteMutation } from './atomic'
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
  grants AS(SELECT g.* FROM vc_site_grants g JOIN args p ON g.source_id=p.site AND g.organization_id=p.organization AND g.category=p.category AND g.operation=p.operation WHERE g.revoked=0),
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
          `${scopeSQL} SELECT m.site_id,m.role,EXISTS(SELECT 1 FROM vc_member_restrictions r JOIN args p ON r.category=p.category AND r.operation=p.operation WHERE r.site_id=m.site_id AND r.user_id=m.user_id) AS restricted FROM members m WHERE m.site_id>? ORDER BY m.site_id LIMIT 100`,
        )
        .bind(...parameters, cursor)
        .all<{ site_id: string; role: SiteRole; restricted: number }>()
      snapshot.memberships.push(
        ...page.results.map((member) => ({
          user: String(this.actor),
          site: member.site_id,
          role: member.role,
          active: true,
          denied: member.restricted ? [{ category, operation }] : [],
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
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_installation_operators WHERE user_id=?',
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
      input.denied.length > 50 ||
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
