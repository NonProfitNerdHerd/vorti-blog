import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { commitCRM, replayCRM } from './mutations'
import { givingDate } from './commitment-model'
import { assertMoney } from './money'
import {
  membershipEnd,
  membershipStatus,
  type MembershipType,
  type MembershipTerm,
} from './membership-model'
export class MembershipRepository {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async scope(siteID: string, operation: 'read' | 'edit' | 'configure') {
    const site = await this.authority.require(siteID, 'memberships', operation)
    const identity = await this.authority.require(siteID, 'identity', 'read')
    if (identity.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return site
  }
  private async fence(root: string, revision: number) {
    const current = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(root)
      .first<{ authority_revision: number }>()
    if (current?.authority_revision !== revision) throw new SiteAccessError()
  }
  async types(siteID: string, after = '') {
    const site = await this.scope(siteID, 'read')
    const rows = await this.db
      .prepare(
        'SELECT * FROM vc_crm_membership_types WHERE site_id=? AND id>? ORDER BY id LIMIT 101',
      )
      .bind(siteID, after)
      .all<MembershipType>()
    const canConfigure = (await this.authority.authority(siteID, 'memberships', 'configure'))
      .allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      docs: rows.results.slice(0, 100),
      next: rows.results.length > 100 ? rows.results[99].id : null,
      canConfigure,
    }
  }
  async saveType(input: {
    site: string
    id?: string
    expectedRevision?: number
    operationKey: string
    values: Record<string, unknown>
  }) {
    const site = await this.scope(input.site, 'configure'),
      v = input.values
    if (
      typeof v.name !== 'string' ||
      !v.name.trim() ||
      v.name.length > 120 ||
      !['person', 'household'].includes(String(v.eligibility))
    )
      throw new Error('Enter a membership type name and eligibility.')
    const minor = String(v.minorUnits),
      currency = String(v.currency),
      exponent = Number(v.exponent),
      months = Number(v.termMonths)
    assertMoney({ currency, minorUnits: minor })
    if (
      BigInt(minor) < 0n ||
      !Number.isInteger(exponent) ||
      exponent < 0 ||
      exponent > 4 ||
      !Number.isInteger(months) ||
      months < 1 ||
      months > 120
    )
      throw new Error('Enter valid membership dues, currency precision and term length.')
    const intent = { id: input.id || null, revision: input.expectedRevision ?? null, ...v },
      action = 'membership.type-saved'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'membership-type',
      intent,
    })
    if (replay) return replay
    const id = input.id || crypto.randomUUID(),
      name = v.name.trim(),
      archived = v.archived === true ? 1 : 0
    if (input.id && !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    const before = input.id
      ? await this.db
          .prepare('SELECT * FROM vc_crm_membership_types WHERE id=? AND site_id=?')
          .bind(id, input.site)
          .first<MembershipType>()
      : null
    if (input.id && !before) throw new SiteAccessError()
    if (before && before.revision !== input.expectedRevision) throw new SiteConflictError()
    if (
      before &&
      before.eligibility !== v.eligibility &&
      (await this.db
        .prepare('SELECT id FROM vc_crm_membership_terms WHERE type_id=? LIMIT 1')
        .bind(id)
        .first())
    )
      throw new Error('Create a separate membership type to change eligibility after enrollment.')
    const write = input.id
      ? this.db
          .prepare(
            'UPDATE vc_crm_membership_types SET name=?,eligibility=?,term_months=?,dues_minor=?,currency=?,exponent=?,archived=?,revision=revision+1 WHERE id=? AND site_id=? AND revision=?',
          )
          .bind(
            name,
            String(v.eligibility),
            months,
            minor,
            currency,
            exponent,
            archived,
            id,
            input.site,
            input.expectedRevision!,
          )
      : this.db
          .prepare(
            'INSERT INTO vc_crm_membership_types(id,site_id,name,eligibility,term_months,dues_minor,currency,exponent,archived) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            id,
            input.site,
            name,
            String(v.eligibility),
            months,
            minor,
            currency,
            exponent,
            archived,
          )
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'membership-type',
      id,
      before,
      after: intent,
      intent,
      write,
      result: { id },
    })
  }
  async list(siteID: string, asOf: string, filter = 'all', after = '', contact = '') {
    givingDate(asOf)
    if (!['all', 'current', 'expiring', 'expired', 'cancelled', 'upcoming'].includes(filter))
      throw new Error('Choose a membership status.')
    const site = await this.scope(siteID, 'read'),
      renewDate = new Date(asOf + 'T00:00:00Z')
    renewDate.setUTCDate(renewDate.getUTCDate() + 30)
    const extra =
      filter === 'all'
        ? ''
        : filter === 'cancelled'
          ? 'AND t.cancelled_on IS NOT NULL AND t.cancelled_on<=?'
          : filter === 'upcoming'
            ? 'AND t.starts_on>? AND (t.cancelled_on IS NULL OR t.cancelled_on>?)'
            : filter === 'expired'
              ? 'AND t.ends_on<? AND (t.cancelled_on IS NULL OR t.cancelled_on>?)'
              : filter === 'expiring'
                ? 'AND t.starts_on<=? AND t.ends_on>=? AND t.ends_on<=? AND (t.cancelled_on IS NULL OR t.cancelled_on>?)'
                : 'AND t.starts_on<=? AND t.ends_on>=? AND (t.cancelled_on IS NULL OR t.cancelled_on>?)'
    const params =
      filter === 'all'
        ? []
        : filter === 'cancelled'
          ? [asOf]
          : filter === 'expiring'
            ? [
                asOf,
                asOf,
                renewDate.getUTCFullYear() > 9999
                  ? '9999-12-31'
                  : renewDate.toISOString().slice(0, 10),
                asOf,
              ]
            : filter === 'current'
              ? [asOf, asOf, asOf]
              : [asOf, asOf]
    const rows = await this.db
      .prepare(
        `SELECT t.*,coalesce(c.label,h.name) AS label FROM vc_crm_membership_terms t LEFT JOIN vc_crm_constituents c ON c.id=t.person_id LEFT JOIN vc_crm_households h ON h.id=t.household_id WHERE t.site_id=? AND t.id>?
      AND (t.person_id IS NULL OR (c.archived=0 AND EXISTS(SELECT 1 FROM vc_crm_affiliations a WHERE a.site_id=t.site_id AND a.constituent_id=c.id AND a.archived=0)))
      ${contact ? 'AND EXISTS(SELECT 1 FROM vc_crm_membership_coverage m JOIN vc_crm_constituents mc ON mc.id=m.constituent_id AND mc.archived=0 JOIN vc_crm_affiliations ma ON ma.constituent_id=mc.id AND ma.site_id=t.site_id AND ma.archived=0 WHERE m.term_id=t.id AND m.constituent_id=?)' : ''} ${extra} ORDER BY t.id LIMIT 51`,
      )
      .bind(siteID, after, ...(contact ? [contact] : []), ...params)
      .all<MembershipTerm>()
    const finance = (await this.authority.authority(siteID, 'finances', 'read')).allowed,
      canEdit = (await this.authority.authority(siteID, 'memberships', 'edit')).allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      docs: rows.results.slice(0, 50).map((t) => ({
        ...t,
        dues_commitment_id: finance ? t.dues_commitment_id : null,
        status: membershipStatus(t, asOf),
      })),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      canEdit,
    }
  }
  async get(siteID: string, id: string, asOf: string) {
    const site = await this.scope(siteID, 'read')
    const term = await this.db
      .prepare(
        `SELECT t.*,coalesce(c.label,h.name) AS label FROM vc_crm_membership_terms t LEFT JOIN vc_crm_constituents c ON c.id=t.person_id LEFT JOIN vc_crm_households h ON h.id=t.household_id WHERE t.id=? AND t.site_id=?`,
      )
      .bind(id, siteID)
      .first<MembershipTerm>()
    if (!term) throw new SiteAccessError()
    const covered = await this.db
      .prepare(
        `SELECT c.id,c.label FROM vc_crm_membership_coverage m JOIN vc_crm_constituents c ON c.id=m.constituent_id AND c.archived=0 JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=? AND a.archived=0 WHERE m.term_id=? ORDER BY c.label,c.id`,
      )
      .bind(siteID, id)
      .all<{ id: string; label: string }>()
    if (term.person_id && !covered.results.some((c) => c.id === term.person_id))
      throw new SiteAccessError()
    const finance = (await this.authority.authority(siteID, 'finances', 'read')).allowed,
      canEdit = (await this.authority.authority(siteID, 'memberships', 'edit')).allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      doc: {
        ...term,
        dues_commitment_id: finance ? term.dues_commitment_id : null,
        status: membershipStatus(term, asOf),
      },
      covered: covered.results,
      canEdit,
    }
  }
  async enroll(input: { site: string; operationKey: string; values: Record<string, unknown> }) {
    const site = await this.scope(input.site, 'edit'),
      v = input.values
    const intent = { ...v },
      action = 'membership.enrolled'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'membership',
      intent,
    })
    if (replay) return replay
    const type = await this.db
      .prepare('SELECT * FROM vc_crm_membership_types WHERE id=? AND site_id=? AND archived=0')
      .bind(String(v.type), input.site)
      .first<MembershipType>()
    if (!type) throw new SiteAccessError()
    if (type.revision !== v.typeRevision) throw new SiteConflictError()
    const start = givingDate(v.startsOn),
      end = v.endsOn ? givingDate(v.endsOn) : membershipEnd(start, type.term_months)
    if (end < start) throw new Error('Choose a membership end date on or after its start.')
    const person = type.eligibility === 'person' ? String(v.person || '') : null,
      household = type.eligibility === 'household' ? String(v.household || '') : null
    let covered: string[] = [],
      householdRevision: number | null = null
    if (person) {
      const c = await this.db
        .prepare(
          "SELECT c.id FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id WHERE c.id=? AND a.site_id=? AND a.archived=0 AND c.archived=0 AND c.kind='person'",
        )
        .bind(person, input.site)
        .first()
      if (!c) throw new SiteAccessError()
      covered = [person]
    } else if (household) {
      await this.authority.require(input.site, 'affiliations', 'read')
      const h = await this.db
        .prepare('SELECT revision FROM vc_crm_households WHERE id=? AND site_id=? AND archived=0')
        .bind(household, input.site)
        .first<{ revision: number }>()
      if (!h || h.revision !== v.householdRevision) throw new SiteConflictError()
      householdRevision = h.revision
      covered = (
        await this.db
          .prepare(
            `SELECT DISTINCT m.constituent_id AS id FROM vc_crm_household_members m JOIN vc_crm_constituents c ON c.id=m.constituent_id AND c.archived=0 JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=? AND a.archived=0 WHERE m.household_id=? AND m.started_on<=? AND (m.ended_on IS NULL OR m.ended_on>=?)`,
          )
          .bind(input.site, household, start, start)
          .all<{ id: string }>()
      ).results.map((c) => c.id)
    } else throw new Error('Choose a membership recipient.')
    const billing = person || String(v.billingContact || '')
    if (!covered.length || covered.length > 200 || !covered.includes(billing))
      throw new Error(
        'Choose a covered member as billing contact; household coverage is captured at the term start date.',
      )
    const renewal = v.renewedFrom ? String(v.renewedFrom) : null
    if (renewal) {
      const prior = await this.get(input.site, renewal, start)
      if (
        prior.doc.revision !== v.previousRevision ||
        prior.doc.type_id !== type.id ||
        prior.doc.person_id !== person ||
        prior.doc.household_id !== household
      )
        throw new SiteConflictError()
      if (start <= prior.doc.ends_on)
        throw new Error('Choose a renewal date after the previous term ends.')
    }
    const paid = BigInt(type.dues_minor) > 0n
    if (paid) await this.authority.require(input.site, 'finances', 'edit')
    const id = crypto.randomUUID(),
      dues = paid ? crypto.randomUUID() : null,
      now = new Date().toISOString()
    const term = this.db
      .prepare(
        'INSERT INTO vc_crm_membership_terms(id,site_id,type_id,person_id,household_id,billing_contact_id,type_name,starts_on,ends_on,dues_minor,currency,exponent,dues_commitment_id,renewed_from,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        input.site,
        type.id,
        person,
        household,
        billing,
        type.name,
        start,
        end,
        type.dues_minor,
        type.currency,
        type.exponent,
        dues,
        renewal,
        this.actor,
        now,
      )
    const guards = [
      this.db
        .prepare(
          'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_crm_membership_types WHERE id=? AND revision=? AND archived=0',
        )
        .bind(`${input.operationKey}:type`, type.id, type.revision),
      this.db
        .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
        .bind(`${input.operationKey}:type`),
      this.db
        .prepare(
          'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN count(*)=? THEN 1 ELSE 0 END FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=? AND a.archived=0 AND a.constituent_id IN(SELECT value FROM json_each(?))',
        )
        .bind(
          `${input.operationKey}:coverage`,
          covered.length,
          input.site,
          JSON.stringify(covered),
        ),
      this.db
        .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
        .bind(`${input.operationKey}:coverage`),
    ]
    if (household)
      guards.push(
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_crm_households WHERE id=? AND revision=? AND archived=0',
          )
          .bind(`${input.operationKey}:household`, household, householdRevision!),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:household`),
      )
    if (renewal)
      guards.push(
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_crm_membership_terms WHERE id=? AND revision=?',
          )
          .bind(`${input.operationKey}:renewal`, renewal, Number(v.previousRevision)),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:renewal`),
      )
    const write = dues
      ? this.db
          .prepare(
            "INSERT INTO vc_crm_commitments(id,site_id,constituent_id,kind,name,currency,exponent,amount_minor,starts_on,ends_on,frequency,created_by,created_at,updated_at) VALUES(?,?,?,'pledge',?,?,?,?,?,?,'annually',?,?,?)",
          )
          .bind(
            dues,
            input.site,
            billing,
            `Membership dues: ${type.name}`,
            type.currency,
            type.exponent,
            type.dues_minor,
            start,
            end,
            this.actor,
            now,
            now,
          )
      : term
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'membership',
      id,
      after: { ...intent, covered, dues },
      intent,
      write,
      dependent: [
        ...(dues
          ? [
              term,
              this.db
                .prepare(
                  'INSERT INTO vc_crm_pledge_installments(id,commitment_id,due_on,amount_minor) VALUES(?,?,?,?)',
                )
                .bind(crypto.randomUUID(), dues, start, type.dues_minor),
            ]
          : []),
        ...guards,
        ...covered.map((c) =>
          this.db
            .prepare('INSERT INTO vc_crm_membership_coverage(term_id,constituent_id) VALUES(?,?)')
            .bind(id, c),
        ),
      ],
      result: { id },
    })
  }
  async cancel(input: {
    site: string
    id: string
    expectedRevision: number
    effectiveOn: string
    reason: string
    operationKey: string
  }) {
    const site = await this.scope(input.site, 'edit'),
      date = givingDate(input.effectiveOn)
    if (
      !input.reason.trim() ||
      input.reason.length > 2000 ||
      !Number.isSafeInteger(input.expectedRevision)
    )
      throw new Error('Enter a cancellation reason and valid revision.')
    const intent = {
        id: input.id,
        expectedRevision: input.expectedRevision,
        effectiveOn: date,
        reason: input.reason,
      },
      action = 'membership.cancelled'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'membership',
      intent,
    })
    if (replay) return replay
    const current = await this.get(input.site, input.id, date)
    if (date < current.doc.starts_on || current.doc.cancelled_on)
      throw new Error('Choose a cancellation date within or after the term start.')
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'membership',
      id: input.id,
      before: current.doc,
      after: intent,
      intent,
      reason: input.reason,
      write: this.db
        .prepare(
          'UPDATE vc_crm_membership_terms SET cancelled_on=?,revision=revision+1 WHERE id=? AND site_id=? AND revision=?',
        )
        .bind(date, input.id, input.site, input.expectedRevision),
      result: { id: input.id },
    })
  }
}
