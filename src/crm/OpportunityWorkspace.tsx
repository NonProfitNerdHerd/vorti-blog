'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Fetch data for the explicitly pinned CRM site and filters. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ContactPicker, crmRead, formatMinor } from './HouseholdWorkspace'
import { ClassificationPicker } from './ClassificationPicker'
import { CommitmentWorkspace } from './CommitmentWorkspace'
import { parseMoney } from './money'
import {
  opportunityOutcomes,
  type Opportunity,
  type OpportunityPipeline,
  type OpportunityStage,
} from './opportunity-model'
import type { OpportunityRepository } from './opportunities'
import type { GiftSummary } from './finance'
type Detail = Awaited<ReturnType<OpportunityRepository['get']>>
type Draft = {
  name: string
  constituent: string
  pipeline: string
  stage: string
  owner: string
  amount: string
  currency: string
  exponent: number
  campaign: string
  targetOn: string
  nextAction: string
  nextOn: string
  notes: string
  archived: boolean
  reason: string
}
const empty = (contact = '', pipeline = '', stage = ''): Draft => ({
  name: '',
  constituent: contact,
  pipeline,
  stage,
  owner: '',
  amount: '',
  currency: 'USD',
  exponent: 2,
  campaign: '',
  targetOn: '',
  nextAction: '',
  nextOn: '',
  notes: '',
  archived: false,
  reason: '',
})
export function OpportunityWorkspace({
  api,
  site,
  contact,
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  contact?: string
  onDirty?: (dirty: boolean) => void
  onSaving?: (busy: boolean) => void
}) {
  const [pipelines, setPipelines] = useState<OpportunityPipeline[]>([]),
    [stages, setStages] = useState<OpportunityStage[]>([]),
    [pipeline, setPipeline] = useState(''),
    [stage, setStage] = useState(''),
    [after, setAfter] = useState(''),
    [next, setNext] = useState<string | null>(null),
    [docs, setDocs] = useState<Opportunity[]>([]),
    [total, setTotal] = useState(0),
    [mode, setMode] = useState<'list' | 'pipeline'>('list'),
    [archived, setArchived] = useState(false),
    [due, setDue] = useState(''),
    [canEdit, setCanEdit] = useState(false),
    [canConfigure, setCanConfigure] = useState(false)
  const [editor, setEditor] = useState<Opportunity | 'new' | null>(null),
    [draft, setDraft] = useState<Draft>(() => empty(contact)),
    [detail, setDetail] = useState<Detail | null>(null),
    [configEditor, setConfigEditor] = useState<{
      kind: 'pipeline' | 'stage'
      id?: string
      revision?: number
      name: string
      position: number
      outcome: string
      archived: boolean
    } | null>(null)
  const [owners, setOwners] = useState<Array<{ id: number; label: string }>>([]),
    [ownerNext, setOwnerNext] = useState<number | null>(null),
    [gifts, setGifts] = useState<GiftSummary[]>([]),
    [giftPage, setGiftPage] = useState(1),
    [giftTotal, setGiftTotal] = useState(0),
    [pledges, setPledges] = useState<Array<{ id: string; name: string; state: string }>>([]),
    [pledgeNext, setPledgeNext] = useState<string | null>(null),
    [linkKind, setLinkKind] = useState<'gift' | 'pledge'>('gift'),
    [linkID, setLinkID] = useState(''),
    [linkReason, setLinkReason] = useState(''),
    [showGiving, setShowGiving] = useState(false),
    [childDirty, setChildDirty] = useState(false),
    [childBusy, setChildBusy] = useState(false)
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0)
  const generation = useRef(0),
    operation = useRef<{ intent: string; key: string } | null>(null)
  const financialDirty = !!linkID || !!linkReason
  useEffect(() => {
    onDirty?.(dirty || childDirty || financialDirty)
  }, [dirty, childDirty, financialDirty, onDirty])
  useEffect(() => {
    onSaving?.(busy || childBusy)
  }, [busy, childBusy, onSaving])
  const clearLinkedDraft = () => {
    setChildDirty(false)
    setChildBusy(false)
    setLinkID('')
    setLinkReason('')
    setShowGiving(false)
  }
  const mark = (value: boolean) => {
    setDirty(value)
    operation.current = null
  }
  const discard = () =>
    !busy &&
    !childBusy &&
    (!(dirty || childDirty || financialDirty) ||
      window.confirm('Discard unsaved opportunity changes?'))
  const url = (values: Record<string, string>) =>
    `${api}/crm/opportunities?${new URLSearchParams({ site, ...values })}`
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || busy || childDirty || childBusy || financialDirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, busy, childDirty, childBusy, financialDirty])
  const load = useCallback(async () => {
    if (!site) return
    const version = ++generation.current
    try {
      const all: OpportunityPipeline[] = []
      let cursor = ''
      let configure = false
      let edit = false
      do {
        const page = await crmRead<Awaited<ReturnType<OpportunityRepository['pipelines']>>>(
          `${api}/crm/opportunities?${new URLSearchParams({ site, view: 'pipelines', after: cursor })}`,
        )
        all.push(...page.docs)
        configure = page.canConfigure
        edit = page.canEdit
        cursor = page.next || ''
      } while (cursor && version === generation.current)
      const query = new URLSearchParams({
        site,
        pipeline,
        stage,
        after,
        archived: String(archived),
        ...(contact ? { contact } : {}),
        ...(due ? { dueThrough: due } : {}),
      })
      const [list, stagePage] = await Promise.all([
        crmRead<Awaited<ReturnType<OpportunityRepository['list']>>>(
          `${api}/crm/opportunities?${query}`,
        ),
        pipeline
          ? crmRead<{ docs: OpportunityStage[] }>(
              `${api}/crm/opportunities?${new URLSearchParams({ site, view: 'stages', pipeline })}`,
            )
          : Promise.resolve({ docs: [] }),
      ])
      if (version !== generation.current) return
      setPipelines(all)
      setCanConfigure(configure)
      setCanEdit(edit)
      setDocs(list.docs)
      setNext(list.next)
      setTotal(list.total)
      setStages(stagePage.docs)
      setError('')
      if (!pipeline && all.length) setPipeline(all[0].id)
    } catch (cause) {
      if (version === generation.current) {
        setDocs([])
        setStages([])
        setPipelines([])
        setCanEdit(false)
        setCanConfigure(false)
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setEditor(null)
          setDetail(null)
          setConfigEditor(null)
          setOwners([])
          setGifts([])
          setPledges([])
          clearLinkedDraft()
          mark(false)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload is the deliberate successful-mutation refresh signal.
  }, [api, site, pipeline, stage, after, archived, contact, due, reload])
  useEffect(() => {
    void load()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Monotonic request fence, not a DOM ref.
      generation.current++
    }
  }, [load])
  const loadOwners = async (cursor = 0) => {
    const version = generation.current
    try {
      const page = await crmRead<Awaited<ReturnType<OpportunityRepository['owners']>>>(
        url({ view: 'owners', after: String(cursor) }),
      )
      if (version === generation.current) {
        setOwners((old) => (cursor ? [...old, ...page.docs] : page.docs))
        setOwnerNext(page.next)
      }
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  const open = async (row: Opportunity | 'new') => {
    if (!discard()) return
    if (row === 'new' && !stages.some((s) => s.pipeline_id === pipeline && !s.archived)) return
    setError('')
    setNotice('')
    setConfigEditor(null)
    clearLinkedDraft()
    setGifts([])
    setPledges([])
    setLinkID('')
    setLinkReason('')
    setDetail(null)
    const version = ++generation.current
    try {
      const data = row === 'new' ? null : await crmRead<Detail>(url({ id: row.id })),
        record = data?.doc
      if (version !== generation.current) return
      setEditor(record || 'new')
      setDetail(data)
      setDraft(
        record
          ? {
              name: record.name,
              constituent: record.constituent_id,
              pipeline: record.pipeline_id,
              stage: record.stage_id,
              owner: record.owner_id ? String(record.owner_id) : '',
              amount:
                record.expected_minor == null
                  ? ''
                  : formatMinor(record.expected_minor, record.exponent),
              currency: record.currency,
              exponent: record.exponent,
              campaign: record.campaign_id || '',
              targetOn: record.target_on || '',
              nextAction: record.next_action,
              nextOn: record.next_on || '',
              notes: record.notes,
              archived: !!record.archived,
              reason: '',
            }
          : empty(
              contact,
              pipeline,
              stages.find((s) => s.pipeline_id === pipeline && !s.archived)?.id || '',
            ),
      )
      mark(false)
      void loadOwners()
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message)
        setEditor(null)
        setDetail(null)
      }
    }
  }
  const mutate = async (body: Record<string, unknown>, keepDetail = false) => {
    if (busy || childBusy) return
    if (keepDetail && (dirty || childDirty)) {
      setError('Save or discard unsaved edits before changing financial links.')
      return
    }
    const version = generation.current,
      intent = JSON.stringify({ site, ...body })
    if (operation.current?.intent !== intent)
      operation.current = { intent, key: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      const result = await crmRead<{ doc: { id: string } }>(`${api}/crm/opportunities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site, ...body, operationKey: operation.current.key }),
      })
      if (version !== generation.current) return
      setDirty(false)
      operation.current = null
      setConfigEditor(null)
      setNotice('Saved.')
      if (keepDetail) {
        const updated = await crmRead<Detail>(url({ id: result.doc.id }))
        if (version === generation.current) {
          setDetail(updated)
          setEditor(updated.doc)
          setLinkID('')
          setLinkReason('')
        }
      } else {
        setEditor(null)
        setDetail(null)
      }
      setReload((n) => n + 1)
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setDocs([])
          setEditor(null)
          setDetail(null)
          setConfigEditor(null)
          setGifts([])
          setPledges([])
          setOwners([])
          clearLinkedDraft()
          setCanEdit(false)
          setCanConfigure(false)
          mark(false)
        }
      }
    } finally {
      setBusy(false)
    }
  }
  const change = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft((old) => ({ ...old, [field]: value }))
    mark(true)
  }
  const save = () => {
    if (!editor) return
    try {
      void mutate({
        action: 'save',
        id: editor === 'new' ? undefined : editor.id,
        expectedRevision: editor === 'new' ? undefined : editor.revision,
        values: {
          ...draft,
          minorUnits: draft.amount.trim()
            ? parseMoney(draft.amount.trim(), { code: draft.currency, exponent: draft.exponent })
                .minorUnits
            : null,
        },
      })
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  const configure = (kind: 'pipeline' | 'stage', row?: OpportunityPipeline | OpportunityStage) => {
    if (!discard()) return
    clearLinkedDraft()
    setEditor(null)
    setDetail(null)
    setConfigEditor({
      kind,
      id: row?.id,
      revision: row?.revision,
      name: row?.name || '',
      position: row && 'position' in row ? row.position : stages.length,
      outcome: row && 'outcome' in row ? row.outcome : 'open',
      archived: !!row?.archived,
    })
    mark(false)
  }
  const loadFinancial = async (
    kind: 'gift' | 'pledge',
    cursor: string | number = kind === 'gift' ? 1 : '',
  ) => {
    if (!detail || !detail.canFinance) return
    const version = generation.current
    try {
      if (kind === 'gift') {
        const page = await crmRead<{ docs: GiftSummary[]; total: number }>(
          `${api}/crm/finance?${new URLSearchParams({ site, constituent: detail.doc.constituent_id, page: String(cursor), limit: '25' })}`,
        )
        if (version === generation.current) {
          setGifts(page.docs)
          setGiftPage(Number(cursor))
          setGiftTotal(page.total)
        }
      } else {
        const page = await crmRead<{
          docs: Array<{ id: string; name: string; state: string }>
          next: string | null
        }>(
          `${api}/crm/giving?${new URLSearchParams({ site, kind: 'pledge', contact: detail.doc.constituent_id, after: String(cursor) })}`,
        )
        if (version === generation.current) {
          setPledges(page.docs)
          setPledgeNext(page.next)
        }
      }
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  const historyPage = async (kind: 'history' | 'links', cursor: string) => {
    if (!detail) return
    const version = generation.current
    try {
      const page = await crmRead<Detail>(
        url({
          id: detail.doc.id,
          ...(kind === 'history' ? { historyAfter: cursor } : { linkAfter: cursor }),
        }),
      )
      if (version === generation.current)
        setDetail((old) =>
          old
            ? {
                ...old,
                [kind]: page[kind],
                ...(kind === 'history'
                  ? { historyNext: page.historyNext }
                  : { linkNext: page.linkNext }),
              }
            : null,
        )
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  const visibleStages = stages.filter((s) => !s.archived || docs.some((d) => d.stage_id === s.id))
  return (
    <section className="vc-crm-domain" aria-label="Opportunities">
      <h2>Opportunities</h2>
      <p>
        Estimates, stages and follow-ups are planning records. Moving to Committed or Received
        creates no pledge, gift or payment.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={busy}>
        <div className="vc-crm-toolbar">
          <label>
            Pipeline
            <select
              value={pipeline}
              onChange={(e) => {
                if (discard()) {
                  setPipeline(e.target.value)
                  setStages([])
                  setDocs([])
                  setTotal(0)
                  setNext(null)
                  clearLinkedDraft()
                  setStage('')
                  setAfter('')
                  setEditor(null)
                  setDetail(null)
                  setConfigEditor(null)
                  mark(false)
                }
              }}
            >
              <option value="">Choose pipeline</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.archived ? ' (archived)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stage
            <select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value)
                setAfter('')
              }}
            >
              <option value="">All stages</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.archived ? ' (archived)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Follow-up due through
            <input
              type="date"
              value={due}
              onChange={(e) => {
                setDue(e.target.value)
                setAfter('')
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked)
                setAfter('')
              }}
            />
            Archived opportunities
          </label>
          <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
            List view
          </button>
          <button
            type="button"
            aria-pressed={mode === 'pipeline'}
            onClick={() => setMode('pipeline')}
          >
            Pipeline view
          </button>
          {canEdit && pipeline && stages.some((s) => s.pipeline_id === pipeline && !s.archived) && (
            <button type="button" onClick={() => void open('new')}>
              Create opportunity
            </button>
          )}
          {canConfigure && (
            <>
              <button type="button" onClick={() => configure('pipeline')}>
                Create pipeline
              </button>
              {pipeline && (
                <button
                  type="button"
                  onClick={() =>
                    configure(
                      'pipeline',
                      pipelines.find((p) => p.id === pipeline),
                    )
                  }
                >
                  Edit pipeline
                </button>
              )}
            </>
          )}
        </div>
      </fieldset>
      <p>
        {total} authorized matching opportunities. Showing {docs.length} on this page.
      </p>
      <div className="vc-crm-toolbar">
        <button type="button" disabled={!after || busy} onClick={() => setAfter('')}>
          First opportunities
        </button>
        <button type="button" disabled={!next || busy} onClick={() => setAfter(next || '')}>
          Next opportunities
        </button>
      </div>
      {mode === 'list' ? (
        <table>
          <thead>
            <tr>
              <th>Opportunity</th>
              <th>Constituent</th>
              <th>Stage</th>
              <th>Estimate</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <button type="button" disabled={busy} onClick={() => void open(d)}>
                    {d.name}
                  </button>
                </td>
                <td>{d.label}</td>
                <td>{stages.find((s) => s.id === d.stage_id)?.name || 'Recorded stage'}</td>
                <td>
                  {d.expected_minor == null
                    ? 'Unspecified'
                    : `${d.currency} ${formatMinor(d.expected_minor, d.exponent)}`}
                </td>
                <td>
                  {d.next_action} {d.next_on}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="vc-crm-pipeline">
          {visibleStages.map((s) => (
            <section key={s.id} aria-label={`${s.name} stage`}>
              <h3>{s.name}</h3>
              {docs
                .filter((d) => d.stage_id === s.id)
                .map((d) => (
                  <article key={d.id}>
                    <button type="button" disabled={busy} onClick={() => void open(d)}>
                      {d.name}
                    </button>
                    <p>{d.label}</p>
                    <p>
                      {d.currency}{' '}
                      {d.expected_minor == null
                        ? 'Unspecified'
                        : formatMinor(d.expected_minor, d.exponent)}
                    </p>
                    <p>
                      {d.next_action} {d.next_on}
                    </p>
                  </article>
                ))}
            </section>
          ))}
        </div>
      )}
      {!docs.length && <p>No matching opportunities.</p>}
      {canConfigure && pipeline && (
        <details>
          <summary>Pipeline stages</summary>
          <p>
            Archive stages to retain their history. Up to 40 stages can be retained in a pipeline.
          </p>
          {stages.map((s) => (
            <p key={s.id}>
              {s.position}: {s.name} — {s.outcome}
              {s.archived ? ' (archived)' : ''}{' '}
              <button type="button" disabled={busy} onClick={() => configure('stage', s)}>
                Edit {s.name}
              </button>
            </p>
          ))}
          <button
            type="button"
            disabled={
              busy || stages.length >= 40 || !!pipelines.find((p) => p.id === pipeline)?.archived
            }
            onClick={() => configure('stage')}
          >
            Add stage
          </button>
        </details>
      )}
      {configEditor && (
        <fieldset disabled={busy} aria-label="Pipeline configuration">
          <legend>{configEditor.kind === 'pipeline' ? 'Pipeline' : 'Stage'} editor</legend>
          <label>
            {configEditor.kind === 'pipeline' ? 'Pipeline name' : 'Stage name'}
            <input
              value={configEditor.name}
              maxLength={120}
              onChange={(e) => {
                setConfigEditor({ ...configEditor, name: e.target.value })
                mark(true)
              }}
            />
          </label>
          {configEditor.kind === 'stage' && (
            <>
              <label>
                Stage order
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={configEditor.position}
                  onChange={(e) => {
                    setConfigEditor({ ...configEditor, position: Number(e.target.value) })
                    mark(true)
                  }}
                />
              </label>
              <label>
                Stage outcome
                <select
                  value={configEditor.outcome}
                  onChange={(e) => {
                    setConfigEditor({ ...configEditor, outcome: e.target.value })
                    mark(true)
                  }}
                >
                  {opportunityOutcomes.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            <input
              type="checkbox"
              checked={configEditor.archived}
              onChange={(e) => {
                setConfigEditor({ ...configEditor, archived: e.target.checked })
                mark(true)
              }}
            />
            Archived classification
          </label>
          <button
            type="button"
            disabled={!configEditor.name.trim()}
            onClick={() =>
              void mutate({
                action: configEditor.kind === 'pipeline' ? 'save-pipeline' : 'save-stage',
                id: configEditor.id,
                expectedRevision: configEditor.revision,
                values: { ...configEditor, pipeline },
              })
            }
          >
            Save configuration
          </button>
          <button
            type="button"
            onClick={() => {
              if (discard()) {
                setConfigEditor(null)
                mark(false)
              }
            }}
          >
            Close configuration
          </button>
        </fieldset>
      )}
      {editor && (
        <section aria-label="Opportunity editor">
          <h3>{editor === 'new' ? 'New opportunity' : editor.name}</h3>
          <fieldset disabled={busy || childBusy || childDirty || financialDirty || !canEdit}>
            <label>
              Opportunity name
              <input
                value={draft.name}
                maxLength={180}
                onChange={(e) => change('name', e.target.value)}
              />
            </label>
            {editor === 'new' && !contact ? (
              <ContactPicker
                api={api}
                site={site}
                value={draft.constituent}
                onChange={(id) => change('constituent', id)}
                label="Constituent"
              />
            ) : (
              <p>{editor === 'new' ? 'Selected contact' : editor.label}</p>
            )}
            <label>
              Opportunity stage
              <select value={draft.stage} onChange={(e) => change('stage', e.target.value)}>
                <option value="">Choose stage</option>
                {stages
                  .filter((s) => !s.archived || s.id === draft.stage)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.archived ? ' (archived)' : ''}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Owner
              <select value={draft.owner} onChange={(e) => change('owner', e.target.value)}>
                <option value="">Unassigned</option>
                {draft.owner && !owners.some((o) => String(o.id) === draft.owner) && (
                  <option value={draft.owner}>Recorded owner #{draft.owner}</option>
                )}
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={ownerNext === null}
              onClick={() => void loadOwners(ownerNext || 0)}
            >
              More eligible owners
            </button>
            <label>
              Expected amount (optional)
              <input
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => change('amount', e.target.value)}
              />
            </label>
            <label>
              Estimate currency
              <input
                value={draft.currency}
                maxLength={3}
                onChange={(e) => change('currency', e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Estimate decimal places
              <select
                value={draft.exponent}
                onChange={(e) => change('exponent', Number(e.target.value))}
              >
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <ClassificationPicker
              api={api}
              site={site}
              kind="campaigns"
              value={draft.campaign}
              onChange={(id) => change('campaign', id)}
            />
            <label>
              Target date
              <input
                type="date"
                value={draft.targetOn}
                onChange={(e) => change('targetOn', e.target.value)}
              />
            </label>
            <label>
              Next action
              <input
                value={draft.nextAction}
                maxLength={1000}
                onChange={(e) => change('nextAction', e.target.value)}
              />
            </label>
            <label>
              Next action date
              <input
                type="date"
                value={draft.nextOn}
                onChange={(e) => change('nextOn', e.target.value)}
              />
            </label>
            <label>
              Private opportunity notes
              <textarea
                value={draft.notes}
                maxLength={16000}
                onChange={(e) => change('notes', e.target.value)}
              />
            </label>
            <label>
              Stage change reason
              <input
                value={draft.reason}
                maxLength={2000}
                onChange={(e) => change('reason', e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.archived}
                onChange={(e) => change('archived', e.target.checked)}
              />
              Archived opportunity
            </label>
            <button
              type="button"
              disabled={!draft.name.trim() || !draft.constituent || !draft.stage}
              onClick={save}
            >
              Save opportunity
            </button>
          </fieldset>
          {detail && (
            <>
              <h4>Stage history</h4>
              <table>
                <thead>
                  <tr>
                    <th>Changed</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.history.map((h) => (
                    <tr key={h.id}>
                      <td>{h.created_at}</td>
                      <td>{h.from_label || 'Created'}</td>
                      <td>{h.to_label}</td>
                      <td>{h.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" disabled={busy} onClick={() => void historyPage('history', '')}>
                First history
              </button>
              <button
                type="button"
                disabled={busy || !detail.historyNext}
                onClick={() => void historyPage('history', detail.historyNext || '')}
              >
                Next history
              </button>
              <h4>Recorded financial links</h4>
              {!detail.canFinance ? (
                <p>Finance access is required to see or change recorded financial links.</p>
              ) : (
                <>
                  <p>
                    These links associate existing records. They do not create revenue, apply pledge
                    payments or change a gift.
                  </p>
                  <ul>
                    {detail.links.map((l) => (
                      <li key={l.id}>
                        {l.gift_id ? 'Gift' : 'Pledge'} {l.gift_id || l.commitment_id} —{' '}
                        {l.removed ? 'removed' : 'linked'}: {l.reason}{' '}
                        {detail.canEdit && !l.removed && (
                          <button
                            type="button"
                            disabled={busy || !linkReason.trim()}
                            onClick={() =>
                              void mutate(
                                {
                                  action: 'unlink',
                                  id: detail.doc.id,
                                  expectedRevision: detail.doc.revision,
                                  link: l.id,
                                  reason: linkReason,
                                },
                                true,
                              )
                            }
                          >
                            Remove financial link
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void historyPage('links', '')}
                  >
                    First links
                  </button>
                  <button
                    type="button"
                    disabled={busy || !detail.linkNext}
                    onClick={() => void historyPage('links', detail.linkNext || '')}
                  >
                    Next links
                  </button>
                  {detail.canEdit && (
                    <fieldset disabled={busy || dirty}>
                      <legend>Link an existing financial record</legend>
                      <label>
                        Link type
                        <select
                          value={linkKind}
                          onChange={(e) => {
                            setLinkKind(e.target.value as 'gift' | 'pledge')
                            setLinkID('')
                            operation.current = null
                          }}
                        >
                          <option value="gift">Received gift</option>
                          <option value="pledge">Recorded pledge</option>
                        </select>
                      </label>
                      <button type="button" onClick={() => void loadFinancial(linkKind)}>
                        Load recorded {linkKind === 'gift' ? 'gifts' : 'pledges'}
                      </button>
                      <label>
                        Financial record
                        <select
                          value={linkID}
                          onChange={(e) => {
                            setLinkID(e.target.value)
                            operation.current = null
                          }}
                        >
                          <option value="">Choose record</option>
                          {linkKind === 'gift'
                            ? gifts
                                .filter((g) => g.state === 'posted')
                                .map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.receivedOn} — {g.currency}{' '}
                                    {formatMinor(g.netMinor, g.exponent)} — {g.id.slice(0, 8)}
                                  </option>
                                ))
                            : pledges.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({p.state})
                                </option>
                              ))}
                        </select>
                      </label>
                      {linkKind === 'gift' ? (
                        <>
                          <button
                            type="button"
                            disabled={giftPage <= 1}
                            onClick={() => void loadFinancial('gift', giftPage - 1)}
                          >
                            Previous recorded gifts
                          </button>
                          <button
                            type="button"
                            disabled={giftPage * 25 >= giftTotal}
                            onClick={() => void loadFinancial('gift', giftPage + 1)}
                          >
                            Next recorded gifts
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => void loadFinancial('pledge', '')}>
                            First recorded pledges
                          </button>
                          <button
                            type="button"
                            disabled={!pledgeNext}
                            onClick={() => void loadFinancial('pledge', pledgeNext || '')}
                          >
                            Next recorded pledges
                          </button>
                        </>
                      )}
                      <label>
                        Financial link reason
                        <input
                          value={linkReason}
                          maxLength={2000}
                          onChange={(e) => {
                            setLinkReason(e.target.value)
                            operation.current = null
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!linkID || !linkReason.trim()}
                        onClick={() =>
                          void mutate(
                            {
                              action: 'link',
                              id: detail.doc.id,
                              expectedRevision: detail.doc.revision,
                              [linkKind]: linkID,
                              reason: linkReason,
                            },
                            true,
                          )
                        }
                      >
                        Link recorded record
                      </button>
                      <p>Save or discard opportunity edits before changing links.</p>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            !childBusy &&
                            (!childDirty || window.confirm('Discard unsaved giving changes?'))
                          ) {
                            setShowGiving((value) => !value)
                            setChildDirty(false)
                          }
                        }}
                      >
                        Open pledge creation and reconciliation
                      </button>
                    </fieldset>
                  )}
                </>
              )}
              {showGiving && detail.canFinance && (
                <>
                  <p>
                    Create a pledge explicitly below, then reload the recorded pledges above and
                    link the saved record. Stage changes never create pledges.
                  </p>
                  <CommitmentWorkspace
                    key={detail.doc.id}
                    api={api}
                    site={site}
                    contact={detail.doc.constituent_id}
                    onDirty={setChildDirty}
                    onSaving={setChildBusy}
                  />
                </>
              )}
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (discard()) {
                setEditor(null)
                setDetail(null)
                clearLinkedDraft()
                mark(false)
              }
            }}
          >
            Close opportunity
          </button>
        </section>
      )}
    </section>
  )
}
