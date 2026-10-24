import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { commitCRM, replayCRM } from './mutations'
import { calendarDate } from './finance'

export interface Household {
  id: string
  name: string
  address: string
  primary_contact: string | null
  archived: number
  revision: number
}
export interface HouseholdMember {
  id: string
  constituent_id: string
  label: string
  role: string
  started_on: string
  ended_on: string | null
  revision: number
}
export interface RelationshipType {
  id: string
  label: string
  reciprocal_label: string
  archived: number
  revision: number
}
export interface Relationship {
  id: string
  other_id: string
  other_label: string
  label: string
  notes: string
  started_on: string
  ended_on: string | null
  revision: number
}
type Mutation = {
  site: string
  operationKey: string
  action: string
  id?: string
  expectedRevision?: number
  values: Record<string, unknown>
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    throw new Error('Enter a valid household or relationship value.')
  return value.trim()
}
function dates(values: Record<string, unknown>) {
  const start = calendarDate(values.startedOn)
  const end = values.endedOn ? calendarDate(values.endedOn) : null
  if (end && end < start) throw new Error('Choose an end date on or after the start date.')
  return { start, end }
}
/** Relationships are chapter-owned. No joins discover identity through another chapter. */
export class HouseholdRepository {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async fence(organization: string, revision: number) {
    const row = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(organization)
      .first<{ authority_revision: number }>()
    if (row?.authority_revision !== revision) throw new SiteAccessError()
  }
  private async contact(site: string, id: string) {
    const row = await this.db
      .prepare(
        `SELECT c.id FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id
      WHERE a.site_id=? AND a.constituent_id=? AND a.archived=0 AND c.archived=0`,
      )
      .bind(site, id)
      .first()
    if (!row) throw new SiteAccessError()
  }
  async list(siteID: string, search = '', after = '') {
    const site = await this.authority.require(siteID, 'affiliations', 'read')
    await this.authority.require(siteID, 'identity', 'read')
    if (search.length > 150 || after.length > 100) throw new Error('Search with fewer characters.')
    const result = await this.db
      .prepare(
        `SELECT id,name,address,NULL AS primary_contact,archived,revision FROM vc_crm_households
      WHERE site_id=? AND id>? AND instr(lower(name),lower(?))>0 ORDER BY id LIMIT 51`,
      )
      .bind(siteID, after, search)
      .all<Household>()
    const canEdit = (await this.authority.authority(siteID, 'affiliations', 'edit')).allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      docs: result.results.slice(0, 50),
      next: result.results.length > 50 ? result.results[49].id : null,
      canEdit,
    }
  }
  async get(siteID: string, id: string) {
    const site = await this.authority.require(siteID, 'affiliations', 'read')
    await this.authority.require(siteID, 'identity', 'read')
    const doc = await this.db
      .prepare(
        'SELECT id,name,address,primary_contact,archived,revision FROM vc_crm_households WHERE id=? AND site_id=?',
      )
      .bind(id, siteID)
      .first<Household>()
    if (!doc) throw new SiteAccessError()
    const members = await this.db
      .prepare(
        `SELECT m.*,c.label FROM vc_crm_household_members m
      JOIN vc_crm_constituents c ON c.id=m.constituent_id JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=? AND a.archived=0
      WHERE m.household_id=? AND c.archived=0 ORDER BY m.started_on,m.id`,
      )
      .bind(siteID, id)
      .all<HouseholdMember>()
    // A primary contact whose affiliation was revoked must not escape via the header.
    if (
      doc.primary_contact &&
      !members.results.some((m) => m.constituent_id === doc.primary_contact && !m.ended_on)
    )
      doc.primary_contact = null
    const canEdit = (await this.authority.authority(siteID, 'affiliations', 'edit')).allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return { doc, members: members.results, canEdit }
  }
  async giving(siteID: string, id: string) {
    const site = await this.authority.require(siteID, 'finances', 'read')
    await this.get(siteID, id)
    // Include a gift once, and only when its donor belonged to this household on its received date.
    const totals = new Map<
      string,
      { currency: string; exponent: number; minorUnits: string; count: number }
    >()
    let after = ''
    for (;;) {
      const page = await this.db
        .prepare(
          `SELECT g.id,g.currency,g.exponent,g.net_minor FROM vc_crm_gifts g
        WHERE g.site_id=? AND g.id>? AND g.kind<>'in-kind' AND g.state='posted'
        AND EXISTS(SELECT 1 FROM vc_crm_household_members m JOIN vc_crm_affiliations a ON a.constituent_id=m.constituent_id AND a.site_id=g.site_id AND a.archived=0
          WHERE m.household_id=? AND m.constituent_id=g.constituent_id AND m.started_on<=g.received_on AND (m.ended_on IS NULL OR m.ended_on>=g.received_on))
        ORDER BY g.id LIMIT 200`,
        )
        .bind(siteID, after, id)
        .all<{ id: string; currency: string; exponent: number; net_minor: string }>()
      for (const gift of page.results) {
        const total = totals.get(gift.currency) || {
          currency: gift.currency,
          exponent: gift.exponent,
          minorUnits: '0',
          count: 0,
        }
        total.minorUnits = (BigInt(total.minorUnits) + BigInt(gift.net_minor)).toString()
        total.count++
        totals.set(gift.currency, total)
      }
      if (page.results.length < 200) break
      after = page.results.at(-1)!.id
    }
    await this.fence(site.organization_id, site.authorityRevision)
    return { totals: [...totals.values()] }
  }
  async relationships(siteID: string, contact: string, after = '') {
    const site = await this.authority.require(siteID, 'affiliations', 'read')
    await this.authority.require(siteID, 'identity', 'read')
    await this.contact(siteID, contact)
    const rows = await this.db
      .prepare(
        `SELECT r.id,r.notes,r.started_on,r.ended_on,r.revision,
      CASE WHEN r.source_id=? THEN r.target_id ELSE r.source_id END AS other_id,
      CASE WHEN r.source_id=? THEN t.label ELSE t.reciprocal_label END AS label,c.label AS other_label
      FROM vc_crm_relationships r JOIN vc_crm_relationship_types t ON t.id=r.type_id
      JOIN vc_crm_constituents c ON c.id=CASE WHEN r.source_id=? THEN r.target_id ELSE r.source_id END
      JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=r.site_id AND a.archived=0
      WHERE r.site_id=? AND (r.source_id=? OR r.target_id=?) AND r.id>? AND c.archived=0 ORDER BY r.id LIMIT 51`,
      )
      .bind(contact, contact, contact, siteID, contact, contact, after)
      .all<Relationship>()
    const types = await this.db
      .prepare(
        'SELECT id,label,reciprocal_label,archived,revision FROM vc_crm_relationship_types WHERE site_id=? ORDER BY label,id',
      )
      .bind(siteID)
      .all<RelationshipType>()
    const households = await this.db
      .prepare(
        `SELECT h.id,h.name,m.role,m.started_on,m.ended_on FROM vc_crm_households h
      JOIN vc_crm_household_members m ON m.household_id=h.id WHERE h.site_id=? AND m.constituent_id=? ORDER BY m.started_on,m.id`,
      )
      .bind(siteID, contact)
      .all()
    const canEdit = (await this.authority.authority(siteID, 'affiliations', 'edit')).allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      docs: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      types: types.results,
      households: households.results,
      canEdit,
    }
  }
  async mutate(input: Mutation): Promise<Record<string, unknown>> {
    const site = await this.authority.require(input.site, 'affiliations', 'edit')
    await this.authority.require(input.site, 'identity', 'read')
    const intent = {
      action: input.action,
      id: input.id || null,
      expectedRevision: input.expectedRevision ?? null,
      values: input.values,
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: input.action,
      type: 'households',
      intent,
    })
    if (replay) return replay
    const values = input.values,
      now = new Date().toISOString()
    const id = input.id || crypto.randomUUID()
    let write: D1PreparedStatement,
      before: unknown = null,
      after: unknown
    const dependent: D1PreparedStatement[] = []
    if (input.action === 'create-household') {
      const name = text(values.name, 180, true),
        address = text(values.address ?? '', 2000)
      const primary = values.primaryContact ? text(values.primaryContact, 100, true) : null
      if (primary) await this.contact(input.site, primary)
      after = { id, name, address, primaryContact: primary, revision: 1 }
      write = this.db
        .prepare(
          'INSERT INTO vc_crm_households(id,site_id,name,address,primary_contact,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(id, input.site, name, address, primary, now, now)
      if (primary)
        dependent.push(
          this.db
            .prepare(
              'INSERT INTO vc_crm_household_members(id,household_id,constituent_id,role,started_on) VALUES(?,?,?,?,?)',
            )
            .bind(
              crypto.randomUUID(),
              id,
              primary,
              'Primary contact',
              calendarDate(values.startedOn),
            ),
        )
    } else if (
      input.action === 'update-household' ||
      input.action === 'add-member' ||
      input.action === 'end-member'
    ) {
      if (!input.id || !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
      const household = await this.get(input.site, input.id)
      before = household.doc
      if (household.doc.revision !== input.expectedRevision) throw new SiteConflictError()
      if (input.action === 'update-household') {
        const name = text(values.name, 180, true),
          address = text(values.address ?? '', 2000)
        const archived = values.archived === true ? 1 : 0
        const primary = values.primaryContact ? text(values.primaryContact, 100, true) : null
        if (primary && !household.members.some((m) => m.constituent_id === primary && !m.ended_on))
          throw new Error('Choose an active household member as primary contact.')
        after = {
          id,
          name,
          address,
          primaryContact: primary,
          archived,
          revision: input.expectedRevision! + 1,
        }
        write = this.db
          .prepare(
            'UPDATE vc_crm_households SET name=?,address=?,primary_contact=?,archived=?,revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=?',
          )
          .bind(name, address, primary, archived, now, id, input.site, input.expectedRevision!)
      } else {
        if (household.doc.archived)
          throw new Error('This record is archived. Restore it before changing members.')
        after = { id, action: input.action, ...values, revision: input.expectedRevision! + 1 }
        write = this.db
          .prepare(
            'UPDATE vc_crm_households SET revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=?',
          )
          .bind(now, id, input.site, input.expectedRevision!)
        if (input.action === 'add-member') {
          const contact = text(values.constituent, 100, true),
            period = dates(values)
          await this.contact(input.site, contact)
          dependent.push(
            this.db
              .prepare(
                'INSERT INTO vc_crm_household_members(id,household_id,constituent_id,role,started_on,ended_on) VALUES(?,?,?,?,?,?)',
              )
              .bind(
                crypto.randomUUID(),
                id,
                contact,
                text(values.role ?? '', 120),
                period.start,
                period.end,
              ),
          )
        } else {
          const member = household.members.find((m) => m.id === values.member && !m.ended_on)
          if (!member) throw new SiteAccessError()
          const end = calendarDate(values.endedOn)
          if (end < member.started_on)
            throw new Error('Choose an end date on or after the start date.')
          dependent.push(
            this.db
              .prepare(
                'UPDATE vc_crm_household_members SET ended_on=?,revision=revision+1 WHERE id=? AND household_id=?',
              )
              .bind(end, member.id, id),
          )
          if (member.constituent_id === household.doc.primary_contact)
            dependent.push(
              this.db
                .prepare('UPDATE vc_crm_households SET primary_contact=NULL WHERE id=?')
                .bind(id),
            )
        }
      }
    } else if (input.action === 'create-type' || input.action === 'update-type') {
      const label = text(values.label, 120, true),
        reciprocal = text(values.reciprocalLabel, 120, true),
        archived = values.archived === true ? 1 : 0
      after = { id, label, reciprocalLabel: reciprocal, archived }
      if (input.action === 'create-type')
        write = this.db
          .prepare(
            'INSERT INTO vc_crm_relationship_types(id,site_id,label,reciprocal_label) VALUES(?,?,?,?)',
          )
          .bind(id, input.site, label, reciprocal)
      else {
        if (!input.id || !Number.isSafeInteger(input.expectedRevision))
          throw new SiteConflictError()
        before = await this.db
          .prepare('SELECT * FROM vc_crm_relationship_types WHERE id=? AND site_id=?')
          .bind(id, input.site)
          .first()
        if (!before) throw new SiteAccessError()
        write = this.db
          .prepare(
            'UPDATE vc_crm_relationship_types SET label=?,reciprocal_label=?,archived=?,revision=revision+1 WHERE id=? AND site_id=? AND revision=?',
          )
          .bind(label, reciprocal, archived, id, input.site, input.expectedRevision!)
      }
    } else if (input.action === 'create-relationship') {
      const source = text(values.source, 100, true),
        target = text(values.target, 100, true),
        type = text(values.type, 100, true),
        period = dates(values),
        notes = text(values.notes ?? '', 4000)
      if (source === target) throw new Error('Choose two different contacts.')
      await this.contact(input.site, source)
      await this.contact(input.site, target)
      after = { id, source, target, type, notes, ...period }
      write = this.db
        .prepare(
          'INSERT INTO vc_crm_relationships(id,site_id,source_id,target_id,type_id,notes,started_on,ended_on) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(id, input.site, source, target, type, notes, period.start, period.end)
    } else if (input.action === 'update-relationship') {
      if (!input.id || !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
      const row = await this.db
        .prepare('SELECT * FROM vc_crm_relationships WHERE id=? AND site_id=?')
        .bind(id, input.site)
        .first<{ source_id: string; target_id: string; started_on: string }>()
      if (!row) throw new SiteAccessError()
      await this.contact(input.site, row.source_id)
      await this.contact(input.site, row.target_id)
      const period = dates(values),
        notes = text(values.notes ?? '', 4000)
      before = row
      after = { id, notes, ...period }
      write = this.db
        .prepare(
          'UPDATE vc_crm_relationships SET notes=?,started_on=?,ended_on=?,revision=revision+1 WHERE id=? AND site_id=? AND revision=?',
        )
        .bind(notes, period.start, period.end, id, input.site, input.expectedRevision!)
    } else throw new Error('Choose a supported household action.')
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: input.action,
      type: 'households',
      id,
      before,
      after,
      intent,
      write,
      dependent,
      result: { id },
    })
  }
}
