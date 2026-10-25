import { ImportContext, type ImportSourceIdentifier } from './import-context'
import { readImportTarget } from './import-target'
import {
  importDomain,
  importFields,
  importSourceSystem,
  type ImportDomain,
  type MappedImportCell,
} from './import-model'
import { PreparedCRMMutations } from './prepared-mutations'
import { ContactRepository } from './contacts'
import {
  validateContactProfile,
  validateRoles,
  validateContactTags,
  type ContactProfile,
} from './contact-model'
import { HouseholdRepository } from './households'
import { FinanceRepository, type GiftKind } from './finance'
import { MembershipRepository } from './memberships'
import { VolunteerRepository } from './volunteers'
import { membershipEnd } from './membership-model'
import { givingDate } from './commitment-model'
import { parseMoney } from './money'

export type ImportDecision = 'create' | 'update' | 'keep' | 'skip'
export type ImportPlanInput = {
  site: string
  domain: ImportDomain
  sourceSystem: string
  values: Record<string, MappedImportCell>
  decision: ImportDecision
  target?: string | null
  operationKey: string
}
export type ImportReview = {
  site: string
  domain: ImportDomain
  sourceSystem: string
  actor: number
  authorityRevision: number
  selection: { decision: ImportDecision; target: string | null }
  values: Record<string, MappedImportCell>
  sourceID: string | null
  targetID: string | null
  before: unknown
  after: unknown
  source: ImportSourceIdentifier | null
  checks: ReturnType<ImportContext['snapshots']>
  issues: Array<{ field?: string; column?: number; message: string }>
}
export type ImportDomainPlan = {
  review: ImportReview
  hash: string
  recordID: string | null
  financial: boolean
  writes: D1PreparedStatement[]
  context: ImportContext
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, stable(item)]),
    )
  return value
}
export async function importPlanHash(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(stable(value))),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}
class Values {
  constructor(
    readonly domain: ImportDomain,
    readonly cells: Record<string, MappedImportCell>,
  ) {
    const allowed = new Set(importFields(domain).map((field) => field.id))
    if (!cells || typeof cells !== 'object' || Array.isArray(cells))
      throw new Error('Choose valid mapped import values.')
    for (const [name, cell] of Object.entries(cells)) {
      if (
        !allowed.has(name) ||
        !cell ||
        typeof cell.value !== 'string' ||
        cell.value.length > 32768 ||
        typeof cell.clear !== 'boolean' ||
        !['record', 'source'].includes(cell.referenceMode) ||
        cell.clear !== !cell.value.trim()
      )
        throw new Error('Choose valid mapped values and explicit blank-cell actions.')
      if (cell.clear && ['sourceID', 'recordID'].includes(name))
        throw new Error('Choose preserve for record identifiers.')
    }
  }
  has(name: string) {
    return Object.hasOwn(this.cells, name)
  }
  text(name: string, fallback = '') {
    return (this.has(name) ? this.cells[name].value : fallback).trim()
  }
  id(name: string) {
    const value = this.text(name).trim()
    if (value.length > 256 || /[\u0000-\u001f\u007f]/.test(value))
      throw new Error('Choose a valid source or record identifier.')
    return value || null
  }
  bool(name: string, fallback = false) {
    if (!this.has(name)) return fallback
    const value = this.text(name).trim().toLowerCase()
    if (['true', 'yes', '1'].includes(value)) return true
    if (['false', 'no', '0'].includes(value)) return false
    throw new Error('Choose true or false for boolean import fields.')
  }
  integer(name: string, min: number, max: number, fallback?: number) {
    if (!this.has(name) && fallback !== undefined) return fallback
    const raw = this.text(name).trim(),
      value = Number(raw)
    if (
      !/^(0|[1-9][0-9]*)$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    )
      throw new Error('Choose a whole number within the field limits.')
    return value
  }
  list(name: string, fallback: string[] = []) {
    if (!this.has(name)) return fallback
    const raw = this.text(name).trim()
    if (!raw) return []
    let result: unknown
    try {
      result = raw.startsWith('[')
        ? JSON.parse(raw)
        : raw
            .split(';')
            .map((item) => item.trim())
            .filter(Boolean)
    } catch {
      throw new Error('Choose a JSON string array or semicolon-separated list.')
    }
    if (!Array.isArray(result) || result.some((item) => typeof item !== 'string'))
      throw new Error('Choose text values for each list item.')
    return result as string[]
  }
  async ref(
    ctx: ImportContext,
    name: string,
    fallback: string | null = null,
    allowArchived = false,
  ) {
    const definition = importFields(this.domain).find((field) => field.id === name)
    if (!definition?.reference) throw new Error('Choose a linked import field.')
    const value = this.text(name, fallback ?? '').trim()
    if (!value) return null
    return ctx.reference(
      definition.reference,
      value,
      this.cells[name]?.referenceMode ?? 'record',
      allowArchived,
    )
  }
  async required(ctx: ImportContext, name: string, fallback?: string) {
    const result = await this.ref(ctx, name, fallback)
    if (!result) throw new Error('Choose all required linked records before importing.')
    return result
  }
}

function contactValues(v: Values, before: Record<string, unknown> | null) {
  const profile: ContactProfile = before
    ? structuredClone(before.profile as ContactProfile)
    : {
        kind: 'person',
        firstName: '',
        lastName: '',
        organizationName: '',
        preferredName: '',
        methods: [],
        addresses: [],
        communication: {
          emailAllowed: true,
          phoneAllowed: true,
          mailAllowed: true,
          volunteerAllowed: true,
        },
      }
  for (const name of [
    'kind',
    'firstName',
    'lastName',
    'organizationName',
    'preferredName',
  ] as const)
    if (v.has(name)) {
      if (name === 'kind') profile.kind = v.text(name).trim() as ContactProfile['kind']
      else profile[name] = v.text(name)
    }
  for (const kind of ['email', 'phone'] as const)
    if (v.has(kind)) {
      let index = profile.methods.findIndex((method) => method.kind === kind && method.primary)
      if (index < 0) index = profile.methods.findIndex((method) => method.kind === kind)
      const value = v.text(kind).trim()
      if (!value) {
        if (index >= 0) profile.methods.splice(index, 1)
      } else if (index >= 0)
        profile.methods[index] = { ...profile.methods[index], value, primary: true }
      else profile.methods.push({ kind, value, label: 'Primary', primary: true })
    }
  const addresses = {
    addressLines: 'lines',
    city: 'city',
    region: 'region',
    postalCode: 'postalCode',
    country: 'country',
  } as const
  if (Object.keys(addresses).some((name) => v.has(name))) {
    const address = profile.addresses[0] ?? {
      label: 'Primary',
      lines: '',
      city: '',
      region: '',
      postalCode: '',
      country: '',
    }
    for (const [name, key] of Object.entries(addresses))
      if (v.has(name)) address[key as keyof typeof address] = v.text(name)
    if (
      [address.lines, address.city, address.region, address.postalCode, address.country].some(
        Boolean,
      )
    )
      profile.addresses[0] = address
    else profile.addresses.splice(0, 1)
  }
  for (const name of ['emailAllowed', 'phoneAllowed', 'mailAllowed', 'volunteerAllowed'] as const)
    if (v.has(name)) profile.communication[name] = v.bool(name)
  return {
    profile: validateContactProfile(profile),
    roles: validateRoles(v.list('roles', (before?.roles as string[]) ?? ['contact'])),
    tags: validateContactTags(v.list('tags', (before?.tags as string[]) ?? [])),
  }
}
const contactProfileFields = [
  'kind',
  'firstName',
  'lastName',
  'organizationName',
  'preferredName',
  'email',
  'phone',
  'addressLines',
  'city',
  'region',
  'postalCode',
  'country',
  'emailAllowed',
  'phoneAllowed',
  'mailAllowed',
  'volunteerAllowed',
]
const immutable = (v: Values, fields: Record<string, unknown>) => {
  for (const [name, old] of Object.entries(fields))
    if (v.has(name) && v.text(name).trim() !== String(old ?? ''))
      throw new Error(
        'Choose a new record to change retained historical attribution or service details.',
      )
}
async function immutableReferences(v: Values, ctx: ImportContext, fields: Record<string, unknown>) {
  for (const [name, old] of Object.entries(fields))
    if (v.has(name)) {
      const reference = await v.ref(ctx, name, null, true)
      if ((reference?.id ?? null) !== (old ?? null))
        throw new Error(
          'Choose a new record to change retained historical attribution or service details.',
        )
    }
}
async function rangeCheck(
  ctx: ImportContext,
  sql: string,
  values: (string | number | null)[],
  message: string,
) {
  const row = (await ctx.db
    .prepare(sql)
    .bind(...values)
    .first<{ n: number }>())!
  if (row.n) throw new Error(message)
  ctx.remember(sql, values, row, ['n'])
}

/** Full domain validation and a prepared transaction, with no writes before approval. */
export async function prepareImportDomain(
  db: D1Database,
  actor: number,
  input: ImportPlanInput,
): Promise<ImportDomainPlan> {
  const domain = importDomain(input.domain),
    sourceSystem = importSourceSystem(input.sourceSystem),
    v = new Values(domain, input.values)
  if (!['create', 'update', 'keep', 'skip'].includes(input.decision))
    throw new Error('Choose create, update, keep or skip for this row.')
  const ctx = await ImportContext.open(db, actor, input.site, domain, sourceSystem),
    prepared = new PreparedCRMMutations(db, actor)
  if (input.decision === 'skip') {
    await ctx.finish()
    const review: ImportReview = {
      site: input.site,
      domain,
      sourceSystem,
      actor,
      authorityRevision: ctx.site.authorityRevision,
      selection: { decision: 'skip', target: null },
      values: input.values,
      sourceID: null,
      targetID: null,
      before: null,
      after: null,
      source: null,
      checks: [],
      issues: [],
    }
    return {
      review,
      hash: await importPlanHash(review),
      recordID: null,
      financial: domain === 'gifts',
      writes: [] as D1PreparedStatement[],
      context: ctx,
    }
  }
  const sourceID = v.id('sourceID'),
    explicit = v.id('recordID')
  if (input.target && explicit && input.target !== explicit)
    throw new Error('Choose one existing record for the import row.')
  const source = sourceID ? await ctx.source(domain, sourceID) : null
  const target = input.target || explicit || source?.record_id || null
  if (source && target !== source.record_id)
    throw new Error(
      'Choose the record already bound to this source identifier; lineage cannot be retargeted.',
    )
  if (input.decision === 'create' && (source || target))
    throw new Error('Choose keep or update for an existing source identifier or record.')
  if (input.decision !== 'create' && !target)
    throw new Error('Choose an existing record for update or keep.')
  const before = target ? await readImportTarget(ctx, target) : null
  let after: unknown = before,
    recordID: string | null = target,
    financial =
      domain === 'gifts' ||
      (domain === 'memberships' && !!before && BigInt(String(before.dues_minor)) > 0n)
  const key = input.operationKey,
    site = input.site
  if (input.decision !== 'keep') {
    if (domain === 'contacts') {
      const desired = contactValues(v, before),
        repo = new ContactRepository(db, actor, prepared.atomic)
      if (before) {
        if (contactProfileFields.some((name) => v.has(name)))
          await repo.updateProfile({
            site,
            id: target!,
            expectedRevision: Number(before.revision),
            confirmedSharedUpdate: true,
            profile: desired.profile,
            operationKey: key + '_profile',
          })
        if (v.has('roles') || v.has('tags'))
          await repo.updateChapter({
            site,
            id: target!,
            expectedRevision: Number(before.affiliationRevision),
            roles: desired.roles,
            tags: desired.tags,
            operationKey: key + '_chapter',
          })
      } else recordID = String((await repo.create({ site, ...desired, operationKey: key })).id)
      after = desired
    } else if (domain === 'households') {
      if (before?.primaryNeedsReview && !v.has('primaryContact'))
        throw new Error(
          'Choose an authorized primary contact or explicitly clear it before updating this household.',
        )
      const primary = await v.ref(
        ctx,
        'primaryContact',
        (before?.primary_contact as string | null) ?? null,
      )
      const desired = {
        name: v.text('name', String(before?.name ?? '')),
        address: v.text('address', String(before?.address ?? '')),
        primaryContact: primary?.id ?? '',
        archived: before?.archived === 1,
        startedOn: v.text('startedOn'),
      }
      const result = await new HouseholdRepository(db, actor, prepared.commit).mutate({
        site,
        id: target ?? undefined,
        expectedRevision: before ? Number(before.revision) : undefined,
        action: before ? 'update-household' : 'create-household',
        values: desired,
        operationKey: key,
      })
      recordID = String(result.id)
      after = desired
    } else if (domain === 'household-members') {
      const household = await v.required(
          ctx,
          'household',
          before?.household_id as string | undefined,
        ),
        contact = await v.required(ctx, 'contact', before?.constituent_id as string | undefined)
      const start = givingDate(v.text('startedOn', String(before?.started_on ?? ''))),
        end = v.text('endedOn', String(before?.ended_on ?? '')).trim()
      if (end && givingDate(end) < start)
        throw new Error('Choose an end date on or after the member start date.')
      const role = v.text('role', String(before?.role ?? '')),
        repo = new HouseholdRepository(db, actor, prepared.commit)
      if (before) {
        await immutableReferences(v, ctx, {
          household: before.household_id,
          contact: before.constituent_id,
        })
        immutable(v, {
          startedOn: before.started_on,
          role: before.role,
        })
        if (before.ended_on || !end)
          throw new Error(
            'Choose keep for retained membership history or provide an end date for an active member.',
          )
        await repo.mutate({
          site,
          id: household.id,
          expectedRevision: household.revision,
          action: 'end-member',
          values: { member: target, endedOn: end },
          operationKey: key,
        })
      } else {
        await rangeCheck(
          ctx,
          `SELECT count(*) AS n FROM vc_crm_household_members WHERE household_id=? AND constituent_id=? AND (ended_on IS NULL OR ended_on>=?) AND (?='' OR started_on<=?)`,
          [household.id, contact.id, start, end, end],
          'Choose non-overlapping household member dates.',
        )
        const result = await repo.mutate({
          site,
          id: household.id,
          expectedRevision: household.revision,
          action: 'add-member',
          values: { constituent: contact.id, role, startedOn: start, endedOn: end },
          operationKey: key,
        })
        recordID = String(result.memberID)
      }
      after = {
        household: household.id,
        contact: contact.id,
        role,
        startedOn: start,
        endedOn: end || null,
      }
    } else if (domain === 'relationships') {
      const source = await v.required(ctx, 'source', before?.source_id as string | undefined),
        related = await v.required(ctx, 'target', before?.target_id as string | undefined)
      const type = await v.ref(ctx, 'type', (before?.type_id as string | null) ?? null, !!before)
      if (!type) throw new Error('Choose a relationship type.')
      if (before)
        await immutableReferences(v, ctx, {
          source: before.source_id,
          target: before.target_id,
          type: before.type_id,
        })
      const desired = {
        source: source.id,
        target: related.id,
        type: type.id,
        startedOn: v.text('startedOn', String(before?.started_on ?? '')),
        endedOn: v.text('endedOn', String(before?.ended_on ?? '')),
        notes: v.text('notes', String(before?.notes ?? '')),
      }
      recordID = String(
        (
          await new HouseholdRepository(db, actor, prepared.commit).mutate({
            site,
            id: target ?? undefined,
            expectedRevision: before ? Number(before.revision) : undefined,
            action: before ? 'update-relationship' : 'create-relationship',
            values: desired,
            operationKey: key,
          })
        ).id,
      )
      after = desired
    } else if (domain === 'gifts') {
      if (before)
        throw new Error(
          'Choose keep for an existing gift; original financial records require retained adjustments.',
        )
      const contact = await v.required(ctx, 'contact'),
        currency = v.text('currency').trim().toUpperCase(),
        exponent = v.integer('exponent', 0, 4)
      const amount = parseMoney(v.text('amount').trim(), { code: currency, exponent })
      const allocations: Array<{ fund: string; currency: string; minorUnits: string }> = []
      if (v.has('allocations') && v.text('allocations').trim()) {
        if (v.has('fund') && v.text('fund').trim())
          throw new Error('Choose one fund or split allocations, not both.')
        let splits: unknown
        try {
          splits = JSON.parse(v.text('allocations'))
        } catch {
          throw new Error('Choose valid split fund allocations.')
        }
        if (!Array.isArray(splits) || !splits.length || splits.length > 20)
          throw new Error('Choose between one and twenty fund allocations.')
        for (const split of splits) {
          if (!split || typeof split.fund !== 'string' || typeof split.amount !== 'string')
            throw new Error('Choose a fund identifier and exact decimal text for each allocation.')
          const fund = await ctx.reference('funds', split.fund)
          allocations.push({
            fund: fund.id,
            ...parseMoney(split.amount, { code: currency, exponent }),
          })
        }
      } else allocations.push({ fund: (await v.required(ctx, 'fund')).id, ...amount })
      const campaign = await v.ref(ctx, 'campaign'),
        appeal = await v.ref(ctx, 'appeal')
      if (appeal?.campaign_id && appeal.campaign_id !== campaign?.id)
        throw new Error('Choose the campaign associated with this appeal.')
      const desired = {
        constituent: contact.id,
        kind: v.text('kind', 'cash') as GiftKind,
        receivedOn: v.text('receivedOn'),
        amount,
        exponent,
        allocations,
        campaign: campaign?.id,
        appeal: appeal?.id,
        reference: v.text('reference'),
        notes: v.text('notes'),
      }
      recordID = String(
        (
          await new FinanceRepository(db, actor, prepared.commit).createGift({
            site,
            ...desired,
            operationKey: key,
          })
        ).id,
      )
      after = desired
    } else if (domain === 'memberships') {
      const repo = new MembershipRepository(db, actor, prepared.commit)
      if (before) {
        await immutableReferences(v, ctx, {
          type: before.type_id,
          contact: before.person_id,
          household: before.household_id,
          billingContact: before.billing_contact_id,
          renewedFrom: before.renewed_from,
        })
        immutable(v, {
          startsOn: before.starts_on,
          endsOn: before.ends_on,
        })
        if (!v.has('cancelledOn'))
          throw new Error('Choose keep for an existing term or record an explicit cancellation.')
        const date = givingDate(v.text('cancelledOn').trim()),
          reason = v.text('cancellationReason').trim()
        await repo.cancel({
          site,
          id: target!,
          expectedRevision: Number(before.revision),
          effectiveOn: date,
          reason,
          operationKey: key,
        })
        after = { ...before, cancelled_on: date }
      } else {
        const type = await v.required(ctx, 'type'),
          start = givingDate(v.text('startsOn').trim()),
          end = givingDate(v.text('endsOn', membershipEnd(start, Number(type.term_months))).trim())
        const person = type.eligibility === 'person' ? await v.required(ctx, 'contact') : null,
          household = type.eligibility === 'household' ? await v.required(ctx, 'household') : null
        const billing = person ?? (await v.required(ctx, 'billingContact')),
          prior = await v.ref(ctx, 'renewedFrom')
        financial = BigInt(String(type.dues_minor)) > 0n
        if (financial) {
          await ctx.require('finances', 'read')
          await ctx.require('finances', 'edit')
        }
        await rangeCheck(
          ctx,
          `SELECT count(*) AS n FROM vc_crm_membership_terms WHERE site_id=? AND type_id=? AND (person_id IS ? AND household_id IS ?) AND starts_on<=? AND ends_on>=? AND (cancelled_on IS NULL OR cancelled_on>?)`,
          [site, type.id, person?.id ?? null, household?.id ?? null, end, start, start],
          'Choose non-overlapping membership terms.',
        )
        const desired = {
          type: type.id,
          typeRevision: type.revision,
          person: person?.id,
          household: household?.id,
          householdRevision: household?.revision,
          billingContact: billing.id,
          startsOn: start,
          endsOn: end,
          renewedFrom: prior?.id,
          previousRevision: prior?.revision,
        }
        recordID = String((await repo.enroll({ site, values: desired, operationKey: key })).id)
        const enrollment = prepared.descriptions().at(-1)!.after as Record<string, unknown>
        after = {
          ...desired,
          duesMinor: type.dues_minor,
          currency: type.currency,
          exponent: type.exponent,
          duesReceived: false,
          covered: [...(enrollment.covered as string[])].sort(),
        }
        if (v.has('cancelledOn')) {
          const date = givingDate(v.text('cancelledOn').trim()),
            reason = v.text('cancellationReason').trim()
          if (date < start || !reason || reason.length > 2000)
            throw new Error('Enter a cancellation date after the term starts and a reason.')
          const intent = { id: recordID, expectedRevision: 1, effectiveOn: date, reason }
          await prepared.commit({
            db,
            actor,
            key: key + '_cancel',
            site,
            organization: ctx.site.organization_id,
            authorityRevision: ctx.site.authorityRevision,
            action: 'membership.cancelled',
            type: 'membership',
            id: recordID,
            before: {
              ...desired,
              id: recordID,
              dues_commitment_id: enrollment.dues ?? null,
              cancelled_on: null,
              revision: 1,
            },
            after: intent,
            intent,
            reason,
            write: db
              .prepare(
                'UPDATE vc_crm_membership_terms SET cancelled_on=?,revision=revision+1 WHERE id=? AND site_id=? AND revision=1',
              )
              .bind(date, recordID, site),
            result: { id: recordID },
          })
          after = {
            ...(after as Record<string, unknown>),
            cancelledOn: date,
            cancellationReason: reason,
          }
        }
      }
    } else if (domain === 'volunteer-profiles') {
      const contact = await v.required(ctx, 'contact', target ?? undefined)
      if (before) await immutableReferences(v, ctx, { contact: before.constituent_id })
      if (!before)
        await rangeCheck(
          ctx,
          'SELECT count(*) AS n FROM vc_crm_volunteer_profiles WHERE site_id=? AND constituent_id=?',
          [site, contact.id],
          'Choose update or keep for an existing volunteer profile.',
        )
      const desired = {
        constituent: contact.id,
        skills: v.list('skills', (before?.skills as string[]) ?? []),
        interests: v.list('interests', (before?.interests as string[]) ?? []),
        availability: v.text('availability', String(before?.availability ?? '')),
        doNotContact: v.bool('doNotContact', before?.do_not_contact === 1),
        archived: before?.archived === 1,
      }
      recordID = String(
        (
          await new VolunteerRepository(db, actor, prepared.commit).saveProfile({
            site,
            id: target ?? undefined,
            expectedRevision: before ? Number(before.revision) : undefined,
            values: desired,
            operationKey: key,
          })
        ).id,
      )
      after = prepared.descriptions().at(-1)!.after
    } else if (domain === 'volunteer-activities') {
      const desired = {
        name: v.text('name', String(before?.name ?? '')),
        description: v.text('description', String(before?.description ?? '')),
        location: v.text('location', String(before?.location ?? '')),
        startsOn: v.text('startsOn', String(before?.starts_on ?? '')),
        endsOn: v.text('endsOn', String(before?.ends_on ?? '')),
        skills: v.list('skills', before ? JSON.parse(String(before.skills)) : []),
        state: v.text('state', String(before?.state ?? 'planned')),
        archived: before?.archived === 1,
      }
      recordID = String(
        (
          await new VolunteerRepository(db, actor, prepared.commit).saveActivity({
            site,
            id: target ?? undefined,
            expectedRevision: before ? Number(before.revision) : undefined,
            values: desired,
            operationKey: key,
          })
        ).id,
      )
      after = prepared.descriptions().at(-1)!.after
    } else if (domain === 'volunteer-participation') {
      const activity = await v.required(ctx, 'activity', before?.activity_id as string | undefined),
        contact = await v.required(ctx, 'contact', before?.constituent_id as string | undefined)
      if (before)
        await immutableReferences(v, ctx, {
          activity: before.activity_id,
          contact: before.constituent_id,
        })
      else
        await rangeCheck(
          ctx,
          'SELECT count(*) AS n FROM vc_crm_volunteer_participation WHERE activity_id=? AND constituent_id=?',
          [activity.id, contact.id],
          'Choose update or keep for existing volunteer participation.',
        )
      const desired = {
        activity: activity.id,
        activityRevision: activity.revision,
        constituent: contact.id,
        state: v.text('state', String(before?.state ?? 'registered')),
        notes: v.text('notes', String(before?.notes ?? '')),
      }
      recordID = String(
        (
          await new VolunteerRepository(db, actor, prepared.commit).participate({
            site,
            id: target ?? undefined,
            expectedRevision: before ? Number(before.revision) : undefined,
            values: desired,
            operationKey: key,
          })
        ).id,
      )
      after = prepared.descriptions().at(-1)!.after
    } else if (domain === 'volunteer-hours') {
      const repo = new VolunteerRepository(db, actor, prepared.commit)
      if (before) {
        await immutableReferences(v, ctx, {
          activity: before.activity_id,
          contact: before.constituent_id,
        })
        immutable(v, {
          occurredOn: before.occurred_on,
          minutes: before.minutes,
        })
        await repo.reviewHours({
          site,
          id: target!,
          expectedRevision: Number(before.revision),
          values: { state: v.text('state'), reason: v.text('reason') },
          operationKey: key,
        })
        after = { ...before, state: v.text('state'), review_reason: v.text('reason').trim() }
      } else {
        const activity = await v.required(ctx, 'activity'),
          contact = await v.required(ctx, 'contact'),
          date = givingDate(v.text('occurredOn').trim()),
          minutes = v.integer('minutes', 1, 1440),
          state = v.text('state', 'submitted').trim(),
          reason = v.text('reason').trim()
        if (!['submitted', 'approved', 'rejected'].includes(state))
          throw new Error('Choose submitted, approved or rejected hours.')
        const desired = {
          activity: activity.id,
          constituent: contact.id,
          occurredOn: date,
          minutes,
        }
        recordID = String((await repo.submitHours({ site, values: desired, operationKey: key })).id)
        if (state !== 'submitted') {
          if (!reason || reason.length > 2000)
            throw new Error('Enter a reason for imported hour review decisions.')
          const intent = { id: recordID, revision: 1, state, reason }
          await prepared.commit({
            db,
            actor,
            key: key + '_review',
            site,
            organization: ctx.site.organization_id,
            authorityRevision: ctx.site.authorityRevision,
            action: 'volunteer.hours.reviewed',
            type: 'volunteer-hours',
            id: recordID,
            before: { ...desired, id: recordID, state: 'submitted', revision: 1 },
            after: intent,
            intent,
            write: db
              .prepare(
                'UPDATE vc_crm_volunteer_hours SET state=?,review_reason=?,reviewed_by=?,reviewed_at=?,revision=revision+1 WHERE id=? AND revision=1',
              )
              .bind(state, reason, actor, new Date().toISOString(), recordID),
            result: { id: recordID },
          })
        }
        after = { ...desired, state, reason }
      }
    }
    if (!prepared.count) throw new Error('Choose keep when there are no mapped changes to apply.')
  }
  await ctx.finish()
  const targetID =
    input.decision === 'create' ? (domain === 'volunteer-profiles' ? recordID : null) : target
  const review: ImportReview = {
    site,
    domain,
    sourceSystem,
    actor,
    authorityRevision: ctx.site.authorityRevision,
    selection: { decision: input.decision, target: input.target ?? null },
    values: input.values,
    sourceID,
    targetID,
    before,
    after,
    source,
    checks: ctx.snapshots(),
    issues: [],
  }
  return {
    review,
    hash: await importPlanHash(review),
    recordID,
    financial,
    writes: [...ctx.guards(key), ...(await prepared.statements())],
    context: ctx,
  }
}
