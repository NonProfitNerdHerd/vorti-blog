'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'
import { workflowTemplates } from './templates'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import {
  registry,
  resources,
  triggerFields,
  type Definition,
  type Resource,
  type Step,
  type StepResult,
} from './model'
import type { AutomationRow } from './store'
import './automations.css'

type Summary = {
  id: string
  mode: string
  status: string
  version: number
  created_at: string
  started_at: string | null
  finished_at: string | null
}
type Run = Summary & {
  valuesVisible: boolean
  definition: Definition | null
  steps: StepResult[]
  error: string | null
  refs: { resource: Resource; id: string }[]
}
const blank = (): Definition => ({ trigger: { kind: 'manual' }, steps: [] })
const labels: Record<Resource, string> = {
  'review-tasks': 'Board items / tasks',
  pages: 'Pages',
  posts: 'Posts',
  'form-submissions': 'Form submissions',
  contacts: 'CRM contacts',
}
const fields: Partial<Record<Resource, string[]>> = {
  'review-tasks': [
    'title',
    'description',
    'initialBoard',
    'status',
    'priority',
    'assignee',
    'dueDate',
  ],
  pages: ['title', 'slug', 'excerpt', '_status', 'content'],
  posts: ['title', 'slug', 'excerpt', '_status', 'content'],
  contacts: ['profile', 'roles', 'tags'],
}
const outputFields: Record<Resource, string[]> = {
  'review-tasks': ['id', 'title', 'status', 'assignee', 'priority', 'dueDate'],
  pages: ['id', 'title', 'slug', 'excerpt', '_status'],
  posts: ['id', 'title', 'slug', 'excerpt', '_status'],
  'form-submissions': ['id', 'answers', 'workflowStatus'],
  contacts: ['id', 'label', 'profile', 'roles', 'tags'],
}

function RecordPicker({
  site,
  resource,
  value,
  onChange,
}: {
  site: string
  resource: Resource | 'task-boards'
  value: string
  onChange: (id: string) => void
}) {
  const [docs, setDocs] = useState<{ id: string; label: string }[]>([]),
    [search, setSearch] = useState(''),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const url =
      resource === 'contacts'
        ? `/api/crm/contacts?site=${encodeURIComponent(site)}&search=${encodeURIComponent(search)}`
        : resource === 'form-submissions'
          ? '/api/form-submissions?limit=50&depth=0'
          : `/api/${resource}?limit=50&depth=0&where[${resource === 'task-boards' ? 'name' : 'title'}][like]=${encodeURIComponent(search)}`
    fetch(url, { headers: { 'x-vorticause-site': site }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error('Records unavailable with your current permissions.')
        const body = (await response.json()) as { docs?: Record<string, unknown>[] }
        setDocs(
          (body.docs || []).map((doc: Record<string, unknown>) => ({
            id: String(doc.id),
            label: String(doc.title || doc.name || doc.label || `Record ${doc.id}`),
          })),
        )
        setError('')
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setDocs([])
          setError(e.message)
        }
      })
    return () => controller.abort()
  }, [site, resource, search])
  return (
    <div>
      <input
        aria-label="Search accessible records"
        placeholder="Search accessible records"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label="Accessible record"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose a record</option>
        {value && !docs.some((d) => d.id === value) && (
          <option value={value}>Saved record (access checked when run)</option>
        )}
        {docs.map((doc) => (
          <option key={doc.id} value={doc.id}>
            {doc.label}
          </option>
        ))}
      </select>
      {error && <small>{error}</small>}
    </div>
  )
}
function MappedInput({
  label,
  value,
  onChange,
  mappings,
}: {
  label: string
  value: unknown
  onChange: (v: unknown) => void
  mappings: string[]
}) {
  const ref = value && typeof value === 'object' && '$ref' in value ? String(value.$ref) : ''
  return (
    <label>
      {label}
      <select
        aria-label={`${label} source`}
        value={ref || ''}
        onChange={(e) => onChange(e.target.value ? { $ref: e.target.value } : '')}
      >
        <option value="">Fixed value</option>
        {mappings.map((path) => (
          <option key={path} value={path}>
            {path}
          </option>
        ))}
        {ref && !mappings.includes(ref) && <option value={ref}>{ref}</option>}
      </select>
      {ref && (
        <input
          aria-label={`${label} mapped field path`}
          value={ref}
          onChange={(e) => onChange({ $ref: e.target.value })}
        />
      )}
      {!ref && (
        <input
          aria-label={`${label} value`}
          value={typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
          onChange={(e) => {
            const text = e.target.value
            if (/^[\[{]/.test(text)) {
              try {
                onChange(JSON.parse(text))
                return
              } catch {}
            }
            onChange(text)
          }}
        />
      )}
    </label>
  )
}
export function AutomationsWorkspace() {
  const { binding } = useAdminSite()
  const params = useSearchParams()
  const view =
    params.get('workflowView') === 'create'
      ? 'create'
      : params.get('workflowView') === 'shared'
        ? 'shared'
        : 'my'
  const site = binding?.site.id || 'default'
  return <AutomationEditor key={`${site}:${view}`} site={site} view={view} />
}
function AutomationEditor({ site, view }: { site: string; view: 'create' | 'my' | 'shared' }) {
  const { user } = useAuth()
  const [transferEmail, setTransferEmail] = useState('')
  const [catalog, setCatalog] = useState(view === 'create')
  const [docs, setDocs] = useState<(AutomationRow & { latest?: string })[]>([]),
    [search, setSearch] = useState(''),
    [doc, setDoc] = useState<AutomationRow | null>(null),
    [definition, setDefinition] = useState<Definition>(blank),
    [name, setName] = useState(''),
    [editing, setEditing] = useState(false),
    [runs, setRuns] = useState<Summary[]>([]),
    [run, setRun] = useState<Run | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [sample, setSample] = useState('{}'),
    [record, setRecord] = useState('')
  const ownsDocument = !doc || String(doc.owner) === String(user?.id)
  const grants = (user as {platformPermissions?: string[]} | null)?.platformPermissions
  const permitted = (action: string) => !Array.isArray(grants) || grants.includes(`workflows:${action}`)
  const api = useCallback(
    async (query = '', body?: unknown) => {
      const response = await fetch(
        `/api/automations?site=${encodeURIComponent(site)}${query}`,
        body
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          : undefined,
      )
      const result = (await response.json()) as {
        message?: string
        docs: (AutomationRow & { latest?: string })[]
        doc: AutomationRow
        runs: Summary[]
        run: Run
        template: { name: string; definition: Definition }
      }
      if (!response.ok) throw Error(result.message || 'Request failed.')
      return result
    },
    [site],
  )
  const refresh = useCallback(async () => {
    setDocs(
      (await api(`&search=${encodeURIComponent(search)}${view === 'shared' ? '&view=shared' : ''}`))
        .docs,
    )
  }, [api, search, view])
  useEffect(() => {
    let live = true
    api(`&search=${encodeURIComponent(search)}${view === 'shared' ? '&view=shared' : ''}`)
      .then((result) => {
        if (live) setDocs(result.docs)
      })
      .catch((e) => {
        if (live) setMessage(e.message)
      })
    return () => {
      live = false
    }
  }, [api, search, view])
  const load = async (id: string) => {
    const result = await api(`&id=${encodeURIComponent(id)}`)
    setDoc(result.doc)
    setRuns(result.runs)
    setName(result.doc.name)
    setDefinition(JSON.parse(result.doc.draft))
    setEditing(false)
    setRun(null)
    setConfirmed(false)
  }
  const act = async (work: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await work()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setBusy(false)
    }
  }
  const patch = (index: number, value: Partial<Step>) =>
    setDefinition((current) => ({
      ...current,
      steps: current.steps.map((s, i) => (i === index ? { ...s, ...value } : s)),
    }))
  const save = async () => {
    const result = await api('', {
      action: 'save',
      id: doc?.id,
      revision: doc?.revision,
      name,
      definition,
    })
    await load(result.doc.id)
  }
  const control = async (action: string) => {
    await api('', { action, id: doc!.id })
    await load(doc!.id)
  }
  const inspect = async (id: string) => setRun((await api(`&run=${encodeURIComponent(id)}`)).run)
  return (
    <main className="automation-workspace">
      <header>
        <div>
          <h1>
            {catalog ? 'Create Workflows' : view === 'shared' ? 'Shared Workflows' : 'My Workflows'}
          </h1>
          <p>Connect forms, CRM, tasks, pages and posts.</p>
        </div>
        <button
          disabled={busy || !permitted('create')}
          onClick={() => {
            setDoc(null)
            setCatalog(true)
            setEditing(false)
            setRun(null)
          }}
        >
          Create Workflow
        </button>
      </header>
      <p role="status">{message}</p>
      {doc || editing ? (
        <>
          <button
            onClick={() => {
              setDoc(null)
              setEditing(false)
              setRun(null)
              refresh().catch((e) => setMessage(e.message))
            }}
          >
            ← {view === 'shared' ? 'Shared Workflows' : 'My Workflows'}
          </button>
          <h2>{name}</h2>
          {doc && (
            <p>
              Owner: {String(doc.owner) === String(user?.id) ? 'you' : `account #${doc.owner}`} · {doc.active ? 'Active' : 'Paused / draft'} · Published
              version {doc.version} · Draft revision {doc.revision}
            </p>
          )}
          {!editing && doc && (
            <nav>
              <button
                disabled={!ownsDocument || !permitted('edit')}
                onClick={() => {
                  setEditing(true)
                  setRun(null)
                }}
              >
                Edit
              </button>
              <button disabled={busy || !ownsDocument || !permitted('publish')} onClick={() => act(() => control('publish'))}>
                Publish own draft
              </button>
              <button disabled={busy || !doc.active || !ownsDocument || !permitted('publish')} onClick={() => act(() => control('pause'))}>
                Pause
              </button>
              <button disabled={busy} onClick={() => act(() => load(doc.id))}>
                Refresh history
              </button>
              <button
                disabled={busy || !doc.published || !ownsDocument || !permitted('share-templates')}
                onClick={() => act(() => control(doc.shared ? 'unshare' : 'share'))}
              >
                {doc.shared ? 'Stop sharing template' : 'Share published template'}
              </button>
            </nav>
          )}
          {!editing && doc && (
            <p>
              {!ownsDocument && 'You are viewing another account’s workflow. Only its owner can edit or run it. '}
              Sharing makes the published definition available as a template to other backend users
              in this site. Copies run with their own permissions. Tenant Administrators can read tenant workflows and run history; their access is audited.
            </p>
          )}
          {!editing && doc && String(doc.owner) === String(user?.id) && (
            <form onSubmit={event => { event.preventDefault(); void act(async () => {
              await api('', { action: 'transfer', id: doc.id, email: transferEmail, confirmPause: true })
              setDoc(null); setTransferEmail(''); setRun(null); await refresh(); setMessage('Ownership transferred. The workflow is paused until its new owner validates and republishes it.')
            }) }}>
              <label>New owner’s account email <input type="email" required value={transferEmail} onChange={event => setTransferEmail(event.target.value)} /></label>
              <p>Transfer pauses this workflow and cancels pending runs. The new owner must review permissions and republish before it runs again.</p>
              <button disabled={busy || !transferEmail} type="submit">Pause and transfer ownership</button>
            </form>
          )}
          {editing ? (
            <section>
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <h3>1. Choose a trigger</h3>
              <label>
                When
                <select
                  value={definition.trigger.kind}
                  onChange={(e) =>
                    setDefinition({
                      ...definition,
                      trigger: {
                        kind: e.target.value as Definition['trigger']['kind'],
                        ...(e.target.value !== 'manual'
                          ? { resource: 'review-tasks' as Resource }
                          : {}),
                      },
                    })
                  }
                >
                  <option value="manual">Manually started</option>
                  <option value="created">A record is created</option>
                  <option value="updated">A selected field changes</option>
                </select>
              </label>
              {definition.trigger.kind === 'manual' && (
                <label>
                  Sample trigger fields (JSON)
                  <textarea value={sample} onChange={(e) => setSample(e.target.value)} />
                </label>
              )}
              {definition.trigger.kind !== 'manual' && (
                <>
                  <label>
                    Resource
                    <select
                      value={definition.trigger.resource}
                      onChange={(e) =>
                        setDefinition({
                          ...definition,
                          trigger: {
                            ...definition.trigger,
                            resource: e.target.value as Resource,
                            recordID: undefined,
                            field: undefined,
                          },
                        })
                      }
                    >
                      {resources.map((r) => (
                        <option key={r} value={r}>
                          {labels[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Optional specific record
                    <RecordPicker
                      site={site}
                      resource={definition.trigger.resource!}
                      value={definition.trigger.recordID || ''}
                      onChange={(id) =>
                        setDefinition({
                          ...definition,
                          trigger: { ...definition.trigger, recordID: id },
                        })
                      }
                    />
                  </label>
                  {definition.trigger.kind === 'updated' && (
                    <label>
                      Field
                      <select
                        value={definition.trigger.field || ''}
                        onChange={(e) =>
                          setDefinition({
                            ...definition,
                            trigger: { ...definition.trigger, field: e.target.value },
                          })
                        }
                      >
                        <option value="">Choose field</option>
                        {triggerFields[definition.trigger.resource!].map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              <h3>2. Configure blocks</h3>
              <p>
                Blocks are retained even when you lack access. Execution checks your current
                permissions. Automation writes do not trigger other workflows.
              </p>
              {definition.steps.map((step, index) => {
                const mappings = [
                  ...(definition.trigger.kind === 'manual'
                    ? Object.keys(
                        (() => {
                          try {
                            return JSON.parse(sample)
                          } catch {
                            return {}
                          }
                        })(),
                      ).map((f) => `trigger.${f}`)
                    : outputFields[definition.trigger.resource!].map((f) => `trigger.${f}`)),
                  ...definition.steps
                    .slice(0, index)
                    .flatMap((s) =>
                      s.kind === 'condition'
                        ? [`steps.${s.id}`]
                        : (outputFields[s.resource!] || []).map((f) => `steps.${s.id}.${f}`),
                    ),
                ]
                return (
                  <article key={step.id}>
                    <header>
                      <h4>
                        {index + 1}. {registry[step.kind].label}
                      </h4>
                      <button
                        onClick={() =>
                          setDefinition({
                            ...definition,
                            steps: definition.steps.filter((_, i) => i !== index),
                          })
                        }
                      >
                        Remove
                      </button>
                    </header>
                    <label>
                      Block name
                      <input
                        value={step.name}
                        onChange={(e) => patch(index, { name: e.target.value })}
                      />
                    </label>
                    <label>
                      Action
                      <select
                        value={step.kind}
                        onChange={(e) => patch(index, { kind: e.target.value as Step['kind'] })}
                      >
                        {Object.entries(registry).map(([kind, item]) => (
                          <option key={kind} value={kind}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Branch
                      <select
                        value={step.when ? `${step.when.step}:${step.when.equals}` : ''}
                        onChange={(e) => {
                          const [id, value] = e.target.value.split(':')
                          patch(index, {
                            when: id ? { step: id, equals: value === 'true' } : undefined,
                          })
                        }}
                      >
                        <option value="">Always run</option>
                        {definition.steps
                          .slice(0, index)
                          .filter((s) => s.kind === 'condition')
                          .flatMap((s) =>
                            [true, false].map((value) => (
                              <option key={`${s.id}${value}`} value={`${s.id}:${value}`}>
                                {s.name}: {String(value)}
                              </option>
                            )),
                          )}
                      </select>
                    </label>
                    {step.kind === 'condition' ? (
                      <>
                        <MappedInput
                          label="Left value"
                          value={step.left}
                          onChange={(v) => patch(index, { left: v })}
                          mappings={mappings}
                        />
                        <select
                          aria-label="Condition operator"
                          value={step.operator || 'equals'}
                          onChange={(e) =>
                            patch(index, { operator: e.target.value as Step['operator'] })
                          }
                        >
                          <option value="equals">Equals</option>
                          <option value="not-equals">Does not equal</option>
                          <option value="exists">Has a value</option>
                        </select>
                        <MappedInput
                          label="Right value"
                          value={step.right}
                          onChange={(v) => patch(index, { right: v })}
                          mappings={mappings}
                        />
                      </>
                    ) : (
                      <>
                        <label>
                          Resource
                          <select
                            value={step.resource}
                            onChange={(e) =>
                              patch(index, { resource: e.target.value as Resource, data: {} })
                            }
                          >
                            {resources
                              .filter((r) => step.kind === 'find' || r !== 'form-submissions')
                              .map((r) => (
                                <option key={r} value={r}>
                                  {labels[r]}
                                </option>
                              ))}
                          </select>
                        </label>
                        {step.kind !== 'create' && (
                          <>
                            <MappedInput
                              label="Record ID"
                              value={step.recordID}
                              onChange={(v) => patch(index, { recordID: v })}
                              mappings={mappings}
                            />
                            <RecordPicker
                              site={site}
                              resource={step.resource!}
                              value={typeof step.recordID === 'string' ? step.recordID : ''}
                              onChange={(id) => patch(index, { recordID: id })}
                            />
                          </>
                        )}
                        {step.kind !== 'find' && (
                          <>
                            {Object.entries(step.data || {}).map(([field, value]) => (
                              <div key={field}>
                                <MappedInput
                                  label={field}
                                  value={value}
                                  onChange={(v) =>
                                    patch(index, { data: { ...step.data, [field]: v } })
                                  }
                                  mappings={mappings}
                                />
                                {field === 'initialBoard' && (
                                  <RecordPicker
                                    site={site}
                                    resource="task-boards"
                                    value={String(value || '')}
                                    onChange={(id) =>
                                      patch(index, {
                                        data: { ...step.data, initialBoard: Number(id) },
                                      })
                                    }
                                  />
                                )}
                                <button
                                  onClick={() => {
                                    const data = { ...step.data }
                                    delete data[field]
                                    patch(index, { data })
                                  }}
                                >
                                  Remove field
                                </button>
                              </div>
                            ))}
                            <select
                              aria-label="Add destination field"
                              value=""
                              onChange={(e) => {
                                if (e.target.value)
                                  patch(index, { data: { ...step.data, [e.target.value]: '' } })
                              }}
                            >
                              <option value="">Add destination field</option>
                              {(fields[step.resource!] || [])
                                .filter((f) => !Object.hasOwn(step.data || {}, f))
                                .map((f) => (
                                  <option key={f}>{f}</option>
                                ))}
                            </select>
                          </>
                        )}
                      </>
                    )}
                  </article>
                )
              })}
              <button
                onClick={() =>
                  setDefinition({
                    ...definition,
                    steps: [
                      ...definition.steps,
                      {
                        id: `block${Date.now()}`,
                        name: `Block ${definition.steps.length + 1}`,
                        kind: 'find',
                        resource: 'review-tasks',
                        operator: 'equals',
                      },
                    ],
                  })
                }
              >
                Add block
              </button>
              <button disabled={busy} onClick={() => act(save)}>
                Save draft
              </button>
              <p>
                For nested form answers, a mapping such as{' '}
                <code>{'{"$ref":"trigger.answers.fieldID"}'}</code> can be entered as a fixed JSON
                value. Structured content and contact profiles accept JSON.
              </p>
            </section>
          ) : (
            doc && (
              <>
                <section>
                  <h3>Trigger</h3>
                  <p>
                    {JSON.parse(doc.draft).trigger.kind} ·{' '}
                    {labels[JSON.parse(doc.draft).trigger.resource as Resource] || 'Manual input'}
                  </p>
                  <h3>Test saved draft</h3>
                  <p>
                    Tests perform real reads and writes using your current permissions. They may
                    create tasks or publish content. Test history remains separate from live runs.
                  </p>
                  <label>
                    Manual input (JSON)
                    <textarea value={sample} onChange={(e) => setSample(e.target.value)} />
                  </label>
                  {JSON.parse(doc.draft).trigger.kind !== 'manual' && (
                    <label>
                      Source record for test
                      <RecordPicker
                        site={site}
                        resource={JSON.parse(doc.draft).trigger.resource}
                        value={record}
                        onChange={setRecord}
                      />
                    </label>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I understand this performs real writes.
                  </label>
                  <button
                    disabled={busy || !confirmed || !ownsDocument || !permitted('execute')}
                    onClick={() =>
                      act(async () => {
                        const result = await api('', {
                          action: 'test',
                          id: doc.id,
                          input: JSON.parse(sample),
                          recordID: record,
                          confirmWrites: true,
                        })
                        await load(doc.id)
                        setRun(result.run)
                      })
                    }
                  >
                    Test draft
                  </button>
                  {doc.active && JSON.parse(doc.published || '{}').trigger?.kind === 'manual' && (
                    <button
                      disabled={busy || !confirmed || !ownsDocument || !permitted('execute')}
                      onClick={() =>
                        act(async () => {
                          const result = await api('', {
                            action: 'run',
                            id: doc.id,
                            input: JSON.parse(sample),
                            confirmWrites: true,
                          })
                          await load(doc.id)
                          setRun(result.run)
                        })
                      }
                    >
                      Run published version
                    </button>
                  )}
                </section>
                <section>
                  <h3>Run history</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Started</th>
                        <th>Mode</th>
                        <th>Version</th>
                        <th>Result</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <button onClick={() => act(() => inspect(r.id))}>
                              {new Date(r.created_at).toLocaleString()}
                            </button>
                          </td>
                          <td>{r.mode}</td>
                          <td>{r.version < 0 ? `Draft ${-r.version}` : r.version}</td>
                          <td>{r.status}</td>
                          <td>
                            {r.started_at && r.finished_at
                              ? `${Date.parse(r.finished_at) - Date.parse(r.started_at)} ms`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!runs.length && <p>No runs yet.</p>}
                </section>
              </>
            )
          )}
          {run && (
            <section>
              <h3>
                Run · {run.status} · version {run.version}
              </h3>
              <p>{run.error}</p>
              {['queued', 'running'].includes(run.status) && (
                <button
                  onClick={() =>
                    act(async () => {
                      await api('', { action: 'cancel', run: run.id })
                      await inspect(run.id)
                    })
                  }
                >
                  Cancel run
                </button>
              )}
              <p>
                {run.valuesVisible
                  ? 'Inputs and outputs show the historical values used by this run. Current record and field permissions were checked; secret fields are masked.'
                  : 'Historical values are withheld because access or source fields changed. Definition and resource references are hidden if record access is revoked.'}
              </p>
              {run.steps.map((s) => (
                <details key={s.id} open={s.status === 'failed'}>
                  <summary>
                    {s.name || s.id} · {s.status} · {s.attempts} attempt(s)
                  </summary>
                  <p>{s.error}</p>
                  <p>
                    {s.startedAt} → {s.finishedAt || '—'}
                  </p>
                  <pre>{JSON.stringify({ inputs: s.inputs, output: s.output }, null, 2)}</pre>
                </details>
              ))}
              <details>
                <summary>Exact definition used</summary>
                <pre>{JSON.stringify(run.definition, null, 2)}</pre>
              </details>
              <button onClick={() => setEditing(true)}>Edit draft and retest</button>
            </section>
          )}
        </>
      ) : catalog ? (
        <section>
          <h2>Choose a workflow or build your own</h2>
          <p>
            Templates start as drafts. Review their triggers, mappings and destinations before
            testing or publishing.
          </p>
          <div className="workflow-template-grid">
            <article>
              <h3>Build a new workflow</h3>
              <p>Start with a trigger and add your own conditions and actions.</p>
              <button
                onClick={() => {
                  setDoc(null)
                  setName('Untitled workflow')
                  setDefinition(blank())
                  setEditing(true)
                  setRun(null)
                }}
              >
                Build from scratch
              </button>
            </article>
            {workflowTemplates.map((template) => (
              <article key={template.id}>
                <h3>{template.name}</h3>
                <p>{template.description}</p>
                <button
                  onClick={() => {
                    setDoc(null)
                    setName(template.name)
                    setDefinition(structuredClone(template.definition))
                    setSample(JSON.stringify(template.sample || {}, null, 2))
                    setEditing(true)
                    setRun(null)
                    setMessage(
                      'Configure this template before publishing. Tests perform real writes.',
                    )
                  }}
                >
                  Use template: {template.name}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <>
          <label>
            Search
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Owner</th>
                <th>{view === 'shared' ? 'Version' : 'Status'}</th>
                <th>{view === 'shared' ? 'Use template' : 'Latest run'}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((item) => (
                <tr key={item.id}>
                  <td>
                    {view === 'shared' ? (
                      item.name
                    ) : (
                      <button onClick={() => act(() => load(item.id))}>{item.name}</button>
                    )}
                  </td>
                  <td>{String(item.owner) === String(user?.id) ? 'You' : `Owner #${item.owner}`}</td>
                  <td>
                    {view === 'shared' ? item.version : item.active ? 'Active' : 'Paused / draft'}
                  </td>
                  <td>
                    {view === 'shared' ? (
                      <button
                        onClick={() =>
                          act(async () => {
                            const { template } = await api(`&shared=${encodeURIComponent(item.id)}`)
                            setDoc(null)
                            setName(`${template.name} (copy)`)
                            setDefinition(template.definition)
                            setEditing(true)
                            setRun(null)
                            setMessage(
                              'This is your own draft copy. Review resource permissions and masked values before publishing.',
                            )
                          })
                        }
                      >
                        Copy to My Workflows
                      </button>
                    ) : (
                      item.latest || 'No runs'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!docs.length && (
            <p>
              {view === 'shared'
                ? 'No workflows have been shared in this site. Publish one of your workflows, then share it as a template.'
                : 'Create a workflow by choosing a template or building your own.'}
            </p>
          )}
        </>
      )}
    </main>
  )
}
