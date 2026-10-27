import { createLocalReq, type CollectionSlug, type Payload, type PayloadRequest } from 'payload'
import { claimRequest } from '../organizations/identity-authority'
import { cmsSiteContext } from '../organizations/cms-scope'
import { ContactRepository } from '../crm/contacts'
import { AutomationStore, type RunRow, type EventRow } from './store'
import {
  mask,
  pathValue,
  resolve,
  type Definition,
  type Reference,
  type Resource,
  type Step,
  type StepResult,
} from './model'

export const AUTOMATION_WRITE = Symbol.for('vorticause.automation-write')
const writeFields: Partial<Record<Resource, string[]>> = {
  'review-tasks': [
    'title',
    'description',
    'initialBoard',
    'status',
    'priority',
    'assignee',
    'dueDate',
    'startDate',
  ],
  pages: ['title', 'slug', 'content', 'excerpt', '_status'],
  posts: ['title', 'slug', 'content', 'excerpt', '_status'],
}
export interface AutomationAdapter {
  authorize(site: string, owner: number): Promise<void>
  authorizeDiagnostics?(site: string, viewer: number): Promise<void>
  read(site: string, owner: number, reference: Reference): Promise<Record<string, unknown>>
  execute(
    site: string,
    owner: number,
    step: Step,
    key: string,
  ): Promise<{ output: Record<string, unknown>; reference: Reference }>
}
/** Every call creates a new request and resolves authority from primary D1 again. */
export function payloadAdapter(payload: Payload, db: D1Database): AutomationAdapter {
  async function request(site: string, owner: number, action: 'execute' | 'diagnostics' | 'read' = 'execute'): Promise<PayloadRequest> {
    // Sole privileged lookup: the stored execution identity, never a target resource.
    const user = await payload.findByID({
      collection: 'users',
      id: owner,
      depth: 0,
      overrideAccess: true,
    })
    const req = await createLocalReq(
      { user: { ...user, collection: 'users' }, context: cmsSiteContext(site) },
      payload,
    )
    const claim = await claimRequest(req, site)
    if (claim?.permissions && !(action === 'read'
      ? claim.permissions.includes('workflows:read') || claim.permissions.includes('workflows:execute')
      : claim.permissions.includes(`workflows:${action}`)))
      throw Error('The account no longer has the required workflow permission in this site.')
    if (
      !claim ||
      (!claim.bootstrap && !claim.operator && !Object.values(claim.allowed).some((v) => v?.length))
    )
      throw Error('The owner no longer has access to this site.')
    return req
  }
  const adapter: AutomationAdapter = {
    authorize: async (site, owner) => {
      await request(site, owner)
    },
    authorizeDiagnostics: async (site, viewer) => {
      await request(site, viewer, 'diagnostics')
    },
    read: async (site, owner, ref) => {
      const req = await request(site, owner, 'read')
      if (ref.resource === 'contacts')
        return { ...(await new ContactRepository(db, owner).get(site, ref.id)) }
      const doc = (await payload.findByID({
        collection: ref.resource as CollectionSlug,
        id: ref.id,
        req,
        overrideAccess: false,
        depth: 0,
        draft: true,
      })) as unknown as Record<string, unknown>
      let actualSite = doc.platformSite || doc.documentSite || doc.site || 'default'
      if (ref.resource === 'review-tasks' && Array.isArray(doc.boards) && doc.boards.length) {
        const sites = new Set<string>()
        for (const value of doc.boards) {
          const id =
            typeof value === 'object' && value ? (value as { id: string }).id : String(value)
          const board = await payload.findByID({
            collection: 'task-boards',
            id,
            req,
            overrideAccess: false,
            depth: 0,
          })
          sites.add(String(board.platformSite || 'default'))
        }
        if (sites.size !== 1) throw Error('The record is outside the automation site.')
        actualSite = [...sites][0]
      }
      if (String(actualSite) !== site) throw Error('The record is outside the automation site.')
      return doc
    },
    execute: async (site, owner, step, key) => {
      const resource = step.resource!,
        req = await request(site, owner)
      if (step.kind === 'find') {
        const reference = { resource, id: String(step.recordID || '') }
        return { output: await adapter.read(site, owner, reference), reference }
      }
      if (resource === 'contacts') {
        if (step.kind !== 'create')
          throw Error(
            'Contact profile updates require shared-profile confirmation in CRM. Use a CRM record task instead.',
          )
        const doc = await new ContactRepository(db, owner).create({
          site,
          profile: step.data?.profile,
          roles: step.data?.roles || [],
          tags: step.data?.tags || [],
          operationKey: key,
        })
        const reference = { resource, id: String(doc.id) }
        return { output: await adapter.read(site, owner, reference), reference }
      }
      const allowed = writeFields[resource]
      if (!allowed || !step.data || Object.keys(step.data).some((k) => !allowed.includes(k)))
        throw Error(
          'The block contains unsupported destination fields. Review the action configuration.',
        )
      if (step.kind === 'update')
        await adapter.read(site, owner, { resource, id: String(step.recordID || '') })
      req.context[AUTOMATION_WRITE as unknown as string] = key
      const data = { ...step.data }
      if (step.kind === 'create' && resource === 'review-tasks' && !data.initialBoard)
        throw Error('Choose a permitted board for the follow-up task.')
      const options = {
        collection: resource as CollectionSlug,
        data: data as never,
        req,
        context: req.context,
        overrideAccess: false,
        depth: 0,
      }
      const doc =
        step.kind === 'create'
          ? await payload.create(options)
          : await payload.update({ ...options, id: String(step.recordID || '') })
      const reference = { resource, id: String(doc.id) }
      return { output: await adapter.read(site, owner, reference), reference }
    },
  }
  return adapter
}
const now = () => new Date().toISOString()
const permissionFailure = (error: unknown) =>
  !!error &&
  typeof error === 'object' &&
  'status' in error &&
  [401, 403, 404].includes(Number(error.status))
export function safeError(error: unknown) {
  if (permissionFailure(error))
    return 'Permission denied or resource unavailable. The owner must currently have access to this resource and its fields.'
  // Do not persist raw provider/SQL/API errors, which can contain secrets or record values.
  return error instanceof Error &&
    /^(A mapped|Choose a permitted|The owner|The record|The block|Contact profile)/.test(
      error.message,
    )
    ? error.message
    : 'The block failed validation or could not complete. Check the mapped fields, destination requirements, and current owner permissions.'
}
export class AutomationRunner {
  constructor(
    readonly store: AutomationStore,
    readonly adapter: AutomationAdapter,
  ) {}
  async tick(limit = 3, only?: string) {
    // An interrupted mutation may have committed. Never replay it automatically.
    await this.store.db
      .prepare(
        `UPDATE vc_automation_runs SET status='failed',error='Worker interrupted. A running block may have committed a write. Inspect the destination before testing again.',
          steps=(SELECT json_group_array(CASE WHEN json_extract(value,'$.status')='running' THEN json_set(value,'$.status','failed','$.error','Worker interrupted; a write may have completed. Inspect the destination before testing again.','$.finishedAt',?) ELSE json(value) END) FROM json_each(steps)),
          finished_at=? WHERE status='running' AND lease_until<?`,
      )
      .bind(now(), now(), now())
      .run()
    let processed = 0
    for (let i = 0; i < limit; i++) {
      const row = await this.store.db
        .prepare(
          `UPDATE vc_automation_runs SET status='running',started_at=?,lease_until=? WHERE id=(SELECT id FROM vc_automation_runs WHERE status='queued' ${only ? 'AND id=?' : ''} ORDER BY created_at,id LIMIT 1) AND status='queued' RETURNING *`,
        )
        .bind(now(), new Date(Date.now() + 120000).toISOString(), ...(only ? [only] : []))
        .first<RunRow>()
      if (!row) break
      await this.execute(row)
      processed++
    }
    return processed
  }
  private async execute(run: RunRow) {
    const definition: Definition = JSON.parse(run.definition),
      results: StepResult[] = JSON.parse(run.steps),
      refs: Reference[] = []
    const context: Record<string, unknown> = { steps: {} }
    const outputReferences = new Map<string, Reference>()
    const outputs = context.steps as Record<string, unknown>
    let status = 'succeeded',
      error: string | null = null
    let currentResult: StepResult | undefined
    const save = async () => {
      const result = await this.store.db
        .prepare(
          "UPDATE vc_automation_runs SET steps=?,refs=?,lease_until=? WHERE id=? AND status='running' AND cancel_requested=0 AND lease_until>?",
        )
        .bind(
          JSON.stringify(mask(results)),
          JSON.stringify(refs),
          new Date(Date.now() + 120000).toISOString(),
          run.id,
          now(),
        )
        .run()
      if (!result.meta.changes) throw Error('Run canceled or execution lease expired.')
    }
    try {
      await this.adapter.authorize(run.site, run.owner)
      const event = JSON.parse(run.event) as EventRow & { input?: Record<string, unknown> }
      if (event.resource) {
        const reference = { resource: event.resource as Resource, id: event.record_id }
        context.trigger = await this.adapter.read(run.site, run.owner, reference)
        refs.push(reference)
      } else context.trigger = event.input || {}
      for (let index = 0; index < definition.steps.length; index++) {
        const original = definition.steps[index],
          result = results[index]
        currentResult = result
        await save()
        // Recheck source and previous outputs before each step, including a read retry.
        await this.adapter.authorize(run.site, run.owner)
        for (const reference of refs) await this.adapter.read(run.site, run.owner, reference)
        // Refresh field-filtered values as well as checking record access. A revoked field
        // must not survive in an earlier block's mapping cache.
        for (const [id, reference] of outputReferences)
          outputs[id] = await this.adapter.read(run.site, run.owner, reference)
        if (event.resource)
          context.trigger = await this.adapter.read(run.site, run.owner, {
            resource: event.resource as Resource,
            id: event.record_id,
          })
        if (original.when && outputs[original.when.step] !== original.when.equals) {
          result.status = 'skipped'
          result.finishedAt = now()
          continue
        }
        result.status = 'running'
        result.startedAt = now()
        await save()
        try {
          const step = resolve(original, context) as Step
          result.inputs = step
          if (step.kind === 'condition') {
            result.attempts = 1
            const equal = JSON.stringify(step.left) === JSON.stringify(step.right)
            outputs[step.id] =
              step.operator === 'exists'
                ? step.left !== undefined && step.left !== null && step.left !== ''
                : step.operator === 'equals'
                  ? equal
                  : !equal
          } else {
            const attempts = step.kind === 'find' ? 3 : 1
            for (let attempt = 1; attempt <= attempts; attempt++) {
              result.attempts = attempt
              await save()
              try {
                const executed = await this.adapter.execute(
                  run.site,
                  run.owner,
                  step,
                  `automation-${run.id}-${step.id}`,
                )
                outputs[step.id] = executed.output
                result.reference = executed.reference
                refs.push(executed.reference)
                outputReferences.set(step.id, executed.reference)
                break
              } catch (failure) {
                if (attempt === attempts || permissionFailure(failure)) throw failure
                await this.adapter.authorize(run.site, run.owner)
              }
            }
          }
          result.output = outputs[original.id]
          result.status = 'succeeded'
          result.finishedAt = now()
          await save()
        } catch (failure) {
          result.status = 'failed'
          result.finishedAt = now()
          result.error = safeError(failure)
          if (original.kind === 'create' || original.kind === 'update')
            result.error +=
              ' A write may have completed. Inspect the destination before testing again.'
          throw failure
        }
      }
    } catch (failure) {
      status = 'failed'
      error = safeError(failure)
      if (currentResult && ['unexecuted', 'running'].includes(currentResult.status)) {
        currentResult.status = 'failed'
        currentResult.finishedAt = now()
        currentResult.error = error
      }
    }
    const fresh = await this.store.db
      .prepare('SELECT cancel_requested FROM vc_automation_runs WHERE id=?')
      .bind(run.id)
      .first<{ cancel_requested: number }>()
    if (fresh?.cancel_requested) {
      status = 'canceled'
      error = 'Canceled. Completed writes are retained.'
    }
    await this.store.db
      .prepare(
        "UPDATE vc_automation_runs SET status=?,error=?,steps=?,refs=?,finished_at=?,lease_until=NULL WHERE id=? AND status='running'",
      )
      .bind(status, error, JSON.stringify(mask(results)), JSON.stringify(refs), now(), run.id)
      .run()
  }
  async diagnostics(run: RunRow, viewer = run.owner) {
    let visible = true
    let valuesVisible = true
    const results = JSON.parse(run.steps) as StepResult[]
    const definition = JSON.parse(run.definition) as Definition
    const current: Record<string, unknown> = { steps: {} }
    // Conservative historical-value policy: every stored field must still occur in
    // today's access-filtered document, including nested form answers. A shape change
    // withholds all values rather than guessing whether a removed field was restricted.
    const covered = (snapshot: unknown, allowed: unknown): boolean => {
      if (snapshot === null || typeof snapshot !== 'object') return allowed !== undefined
      if (!allowed || typeof allowed !== 'object') return false
      return Object.entries(snapshot).every(
        ([key, value]) =>
          Object.hasOwn(allowed, key) && covered(value, (allowed as Record<string, unknown>)[key]),
      )
    }
    try {
      await (this.adapter.authorizeDiagnostics || this.adapter.authorize)(run.site, viewer)
      for (const reference of JSON.parse(run.refs) as Reference[])
        await this.adapter.read(run.site, viewer, reference)
      const event = JSON.parse(run.event) as EventRow & { input?: unknown }
      current.trigger = event.resource
        ? await this.adapter.read(run.site, viewer, {
            resource: event.resource as Resource,
            id: event.record_id,
          })
        : event.input || {}
      for (const result of results) {
        if (result.reference) {
          const allowed = await this.adapter.read(run.site, viewer, result.reference)
          ;(current.steps as Record<string, unknown>)[result.id] = allowed
          if (!covered(result.output, allowed)) valuesVisible = false
        } else if (definition.steps.find((s) => s.id === result.id)?.kind === 'condition') {
          ;(current.steps as Record<string, unknown>)[result.id] = result.output
        } else if (result.output !== undefined) valuesVisible = false
      }
      const checkMapping = (original: unknown, historical: unknown): boolean => {
        if (!original || typeof original !== 'object') return true
        if (Object.keys(original).length === 1 && '$ref' in original)
          return covered(historical, pathValue(current, String(original.$ref)))
        return Object.entries(original).every(([key, value]) =>
          checkMapping(
            value,
            historical && typeof historical === 'object'
              ? (historical as Record<string, unknown>)[key]
              : undefined,
          ),
        )
      }
      for (const result of results) {
        const step = definition.steps.find((s) => s.id === result.id)
        if (result.inputs && step && !checkMapping(step, result.inputs)) valuesVisible = false
      }
    } catch {
      visible = false
      valuesVisible = false
    }
    const steps = results.map(({ inputs: _inputs, output: _output, ...step }) => ({
      ...step,
      reference: visible ? step.reference : undefined,
      inputs: valuesVisible
        ? mask(_inputs)
        : visible
          ? '[Values withheld because source fields changed or are restricted.]'
          : '[Access revoked]',
      output: valuesVisible
        ? mask(_output)
        : visible
          ? '[Values withheld because destination fields changed or are restricted.]'
          : '[Access revoked]',
    }))
    return {
      ...run,
      definition: visible ? mask(JSON.parse(run.definition)) : null,
      event: undefined as unknown,
      refs: visible ? JSON.parse(run.refs) : [],
      steps,
      valuesVisible,
    }
  }
}
