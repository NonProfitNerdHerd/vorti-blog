'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Explicit context changes clear old chapter records. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Gutter, useConfig } from '@payloadcms/ui'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { crmRead, formatMinor } from './HouseholdWorkspace'
import type { Classification, ClassificationKind } from './fundraising'
import { parseMoney } from './money'
import { CRMEditorDialog } from './CRMEditorDialog'
import { useSearchParams } from 'next/navigation'
type Values = {
  name: string
  description: string
  startsOn: string
  endsOn: string
  currency: string
  exponent: number
  goalAmount: string
  archived: boolean
}
const empty = (): Values => ({
  name: '',
  description: '',
  startsOn: '',
  endsOn: '',
  currency: 'USD',
  exponent: 2,
  goalAmount: '',
  archived: false,
})
type Gift = {
  id: string
  label: string
  currency: string
  exponent: number
  net_minor: string
  kind: string
  state: string
  received_on: string
}
export function FundraisingWorkspace() {
  const params = useSearchParams()
  const initialKind = params.get('resultType')
  const initialRecord = params.get('result')
  const { config } = useConfig(),
    { binding } = useAdminSite(),
    api = config.routes.api,
    site = binding?.site.id || ''
  const [kind, setKind] = useState<ClassificationKind>(initialKind === 'funds' || initialKind === 'appeals' ? initialKind : 'campaigns'),
    [docs, setDocs] = useState<Classification[]>([]),
    [next, setNext] = useState<string | null>(null),
    [after, setAfter] = useState('')
  const [canEdit, setCanEdit] = useState(false),
    [editor, setEditor] = useState<Classification | 'new' | null>(null),
    [editing, setEditing] = useState(false),
    [values, setValues] = useState<Values>(empty)
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [gifts, setGifts] = useState<Gift[] | null>(null),
    [giftNext, setGiftNext] = useState<string | null>(null)
  const generation = useRef(0),
    operation = useRef<{ fingerprint: string; key: string } | null>(null)
  const load = useCallback(async () => {
    if (!site) return
    const version = ++generation.current
    try {
      const data = await crmRead<{ docs: Classification[]; next: string | null; canEdit: boolean }>(
        `${api}/crm/fundraising?site=${encodeURIComponent(site)}&kind=${kind}&after=${encodeURIComponent(after)}`,
      )
      if (version === generation.current) {
        setDocs(data.docs)
        setCanEdit(data.canEdit)
        setNext(data.next)
        setError('')
      }
    } catch (cause) {
      if (version === generation.current) {
        setDocs([])
        setCanEdit(false)
        setError((cause as Error).message)
      }
    }
  }, [api, site, kind, after])
  useEffect(() => {
    void load()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate current async requests; this is a monotonic counter, not a DOM ref.
      generation.current++
    }
  }, [load])
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty || busy) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, busy])
  const set = <K extends keyof Values>(field: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [field]: value }))
    setDirty(true)
    operation.current = null
  }
  const open = (row: Classification | 'new') => {
    if (busy || (dirty && !window.confirm('Discard unsaved fundraising changes?'))) return
    setEditor(row)
    setEditing(row === 'new')
    setGifts(null)
    setGiftNext(null)
    setNotice('')
    setDirty(false)
    operation.current = null
    setValues(
      row === 'new'
        ? empty()
        : {
            name: row.name,
            description: row.description,
            startsOn: row.starts_on || '',
            endsOn: row.ends_on || '',
            currency: row.currency || 'USD',
            exponent: row.exponent ?? 2,
            goalAmount: row.goal_minor ? formatMinor(row.goal_minor, row.exponent ?? 0) : '',
            archived: !!row.archived,
          },
    )
  }
  const openedSearchResult = useRef('')
  useEffect(() => {
    if (!initialRecord || openedSearchResult.current === initialRecord || !site) return
    openedSearchResult.current = initialRecord
    void crmRead<{ doc: Classification }>(`${api}/crm/fundraising?${new URLSearchParams({ site, kind, record: initialRecord })}`)
      .then(result => open(result.doc)).catch(cause => setError((cause as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Open once for the URL-selected classification.
  }, [initialRecord, site])
  const save = async () => {
    if (!editor || busy) return
    let goalMinor = ''
    try {
      if (kind !== 'funds' && values.goalAmount.trim())
        goalMinor = parseMoney(values.goalAmount.trim(), {
          code: values.currency,
          exponent: values.exponent,
        }).minorUnits
    } catch (cause) {
      setError((cause as Error).message)
      return
    }
    const version = generation.current,
      body = {
        action: 'save',
        site,
        kind,
        values: { ...values, goalMinor },
        id: editor === 'new' ? undefined : editor.id,
        expectedRevision: editor === 'new' ? undefined : editor.revision,
      }
    const fingerprint = JSON.stringify(body)
    if (operation.current?.fingerprint !== fingerprint)
      operation.current = { fingerprint, key: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      await crmRead(`${api}/crm/fundraising`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationKey: operation.current.key }),
      })
      if (version !== generation.current) return
      operation.current = null
      setDirty(false)
      setEditor(null)
      setEditing(false)
      setNotice('Saved.')
      await load()
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setDocs([])
          setEditor(null)
          setCanEdit(false)
        }
      }
    } finally {
      setBusy(false)
    }
  }
  const loadGifts = async (cursor = '') => {
    if (!editor || editor === 'new') return
    const version = generation.current
    try {
      const data = await crmRead<{ docs: Gift[]; next: string | null }>(
        `${api}/crm/fundraising?site=${encodeURIComponent(site)}&kind=${kind}&id=${editor.id}&after=${encodeURIComponent(cursor)}`,
      )
      if (version === generation.current) {
        setGifts(data.docs)
        setGiftNext(data.next)
      }
    } catch (cause) {
      if (version === generation.current) {
        setGifts(null)
        setError((cause as Error).message)
      }
    }
  }
  return (
    <Gutter className="vc-crm vc-crm-domain vc-crm-collection">
      <h2>Campaigns, funds and appeals</h2>
      <nav aria-label="Fundraising sections" className="vc-crm-toolbar">
        {(['campaigns', 'funds', 'appeals'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm('Discard unsaved fundraising changes?')) {
                setKind(k)
                setAfter('')
                setEditor(null)
                setDirty(false)
                setGifts(null)
              }
            }}
          >
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="vc-crm-toolbar">
        {canEdit && (
          <button type="button" className="vc-crm-primary" disabled={busy} onClick={() => open('new')}>
            Create {kind === 'campaigns' ? 'campaign' : kind === 'funds' ? 'fund' : 'appeal'}
          </button>
        )}
        <button type="button" disabled={!after || busy} onClick={() => setAfter('')}>
          First page
        </button>
        <button type="button" disabled={!next || busy} onClick={() => setAfter(next || '')}>
          Next page
        </button>
      </div>
      <div className="vc-crm-table-wrap"><table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Dates</th>
            <th>Goal</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} data-selected={editor !== 'new' && editor?.id === d.id ? 'true' : undefined}>
              <td>
                <button type="button" disabled={busy} onClick={() => open(d)}>
                  {d.name}
                </button>
              </td>
              <td>{d.archived ? 'Archived' : 'Active'}</td>
              <td>
                {d.starts_on || 'No start'} – {d.ends_on || 'No end'}
              </td>
              <td>
                {d.goal_minor ? `${d.currency} ${formatMinor(d.goal_minor, d.exponent || 0)}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!docs.length && <p>No {kind} yet.</p>}
      {editor && (
        <section aria-label="Fundraising editor">
          <h3>{editor === 'new' ? 'New record' : editor.name}</h3>
          {editor !== 'new' && canEdit && <button type="button" onClick={() => { open(editor); setEditing(true) }}>Edit {kind.slice(0, -1)}</button>}
          {editing && <CRMEditorDialog title={editor === 'new' ? `New ${kind.slice(0, -1)}` : `Edit ${editor.name}`}
            onDismiss={() => {
              if (dirty && !window.confirm('Discard unsaved fundraising changes?')) return
              if (editor === 'new') setEditor(null)
              setEditing(false)
              setDirty(false)
            }}><form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <fieldset disabled={!canEdit || busy}>
              <label>
                Name
                <input
                  required
                  maxLength={180}
                  value={values.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </label>
              <label>
                Description
                <textarea
                  maxLength={4000}
                  value={values.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </label>
              <label>
                Start date
                <input
                  type="date"
                  value={values.startsOn}
                  onChange={(e) => set('startsOn', e.target.value)}
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  value={values.endsOn}
                  onChange={(e) => set('endsOn', e.target.value)}
                />
              </label>
              {kind !== 'funds' && (
                <>
                  <label>
                    Currency
                    <input
                      maxLength={3}
                      value={values.currency}
                      onChange={(e) => set('currency', e.target.value.toUpperCase())}
                    />
                  </label>
                  <label>
                    Currency decimal places
                    <input
                      type="number"
                      min={0}
                      max={4}
                      value={values.exponent}
                      onChange={(e) => set('exponent', Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Goal amount (optional)
                    <input
                      inputMode="decimal"
                      value={values.goalAmount}
                      onChange={(e) => set('goalAmount', e.target.value)}
                    />
                  </label>
                  <p>
                    {values.goalAmount
                      ? `${values.currency} ${values.goalAmount}`
                      : 'Leave blank for no goal.'}
                  </p>
                </>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={values.archived}
                  onChange={(e) => set('archived', e.target.checked)}
                />
                Archived
              </label>
              <button type="submit">Save</button>
            </fieldset>
          </form></CRMEditorDialog>}
          {editor !== 'new' && (
            <>
              <button type="button" onClick={() => void loadGifts()}>
                View linked gifts
              </button>
              {gifts && (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>Donor</th>
                        <th>Received</th>
                        <th>Net gift amount</th>
                        <th>Kind/status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gifts.map((g) => (
                        <tr key={g.id}>
                          <td>{g.label}</td>
                          <td>{g.received_on}</td>
                          <td>
                            {g.currency} {formatMinor(g.net_minor, g.exponent)}
                          </td>
                          <td>
                            {g.kind} / {g.state}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {kind === 'funds' && (
                    <p>Amounts shown are whole gifts; allocations determine each fund’s share.</p>
                  )}
                  {!gifts.length && <p>No linked gifts.</p>}
                  <button
                    type="button"
                    disabled={!giftNext}
                    onClick={() => void loadGifts(giftNext || '')}
                  >
                    Next gifts
                  </button>
                </>
              )}
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm('Discard unsaved fundraising changes?')) {
                setEditor(null)
                setDirty(false)
              }
            }}
          >
            Close
          </button>
        </section>
      )}
    </Gutter>
  )
}
