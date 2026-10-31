'use client'
/* eslint-disable react-hooks/set-state-in-effect -- URL and site changes reset draft state. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Gutter, useConfig } from '@payloadcms/ui'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { CRMEditorDialog } from './CRMEditorDialog'
import { crmRead, formatMinor } from './HouseholdWorkspace'
import { parseMoney } from './money'
import { RecordTasks } from './RecordTasks'
import type { ClassificationKind } from './fundraising'

type Total = { currency: string; exponent: number; minor: string }
type RecordRow = { id: string; name: string; description: string; starts_on: string | null; ends_on: string | null; currency: string | null; exponent: number | null; goal_minor: string | null; archived: number; revision: number; received: Total[]; outstanding?: Total[]; appealCount?: number; fundCount?: number; campaignCount?: number; campaign_id?: string | null; default_fund_id?: string | null; status?: string; channel?: string; send_on?: string | null; internal_code?: string; audience?: { selected: number; eligible: number } }
type Gift = { id: string; label: string; currency: string; exponent: number; net_minor: string; received_on: string; campaign_id: string | null; appeal_id: string | null; funds: Array<{ id: string; minor: string }> }
type Report = { campaigns: RecordRow[]; appeals: RecordRow[]; funds: RecordRow[]; links: Array<{ campaign_id: string; fund_id: string }>; gifts: Gift[]; recipients: Array<{ constituent_id: string; appeal_id: string; label: string; eligible: number; exclusion: string }>; outreach: Array<{ id: string; appeal_id: string; channel: string; recipient_count: number; notes: string; occurred_at: string }>; activity: Array<{ record_type: string; record_id: string; action: string; created_at: string }>; totals: Total[]; canEdit: boolean; canRecordOutreach: boolean; canSeeAudience: boolean; canSeeNames: boolean; asOf: string }
type Values = { name: string; description: string; startsOn: string; endsOn: string; currency: string; exponent: number; goalAmount: string; archived: boolean; campaignId: string; defaultFundId: string; status: string; channel: string; sendOn: string; internalCode: string; fundIds: string[]; recipientIds: string[] }
const empty = (): Values => ({ name: '', description: '', startsOn: '', endsOn: '', currency: 'USD', exponent: 2, goalAmount: '', archived: false, campaignId: '', defaultFundId: '', status: 'draft', channel: 'email', sendOn: '', internalCode: '', fundIds: [], recipientIds: [] })
const labels: Record<ClassificationKind, string> = { campaigns: 'Campaigns', appeals: 'All appeals', funds: 'Funds' }
const sum = (totals: Total[] | undefined, currency: string) => totals?.find(t => t.currency === currency)
const money = (total: Total | undefined) => total ? `${total.currency} ${formatMinor(total.minor, total.exponent)}` : '—'
const dates = (row: RecordRow) => `${row.starts_on || 'No start'} – ${row.ends_on || 'No end'}`
function pct(row: RecordRow, currency: string) {
  if (row.currency !== currency || !row.goal_minor || BigInt(row.goal_minor) <= 0n) return 0
  return Math.min(100, Number(BigInt(sum(row.received, currency)?.minor || '0') * 10000n / BigInt(row.goal_minor)) / 100)
}

export function FundraisingWorkspace() {
  const { config } = useConfig(), { binding } = useAdminSite(), router = useRouter(), params = useSearchParams()
  const site = binding?.site.id || '', api = config.routes.api, admin = config.routes.admin
  const rawKind = params.get('resultType') || params.get('fundraisingKind')
  const kind: ClassificationKind = rawKind === 'appeals' || rawKind === 'funds' ? rawKind : 'campaigns'
  const recordID = params.get('result') || '', creating = params.get('fundraisingMode') === 'create' && kind === 'appeals', campaignParam = params.get('campaign') || ''
  const [report, setReport] = useState<Report | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0), [currency, setCurrency] = useState(''), [filter, setFilter] = useState(''), [state, setState] = useState('all'), [page, setPage] = useState(0), [tab, setTab] = useState('Overview')
  const [dialog, setDialog] = useState(false), [values, setValues] = useState<Values>(empty), [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false)
  const [contactSearch, setContactSearch] = useState(''), [candidates, setCandidates] = useState<Array<{ id: string; label: string }>>([])
  const [outreachNotes, setOutreachNotes] = useState(''), [outreachDate, setOutreachDate] = useState(new Date().toISOString().slice(0, 10))
  const request = useRef(0), operation = useRef<{ fingerprint: string; key: string } | null>(null)
  const rows = report?.[kind] || [], selected = rows.find(row => row.id === recordID)
  const currencies = [...new Set([...(report?.totals || []).map(t => t.currency), ...(report?.campaigns || []).map(c => c.currency).filter((c): c is string => !!c)])].sort()
  const activeCurrency = currencies.includes(currency) ? currency : currencies[0] || ''
  const filtered = rows.filter(row => row.name.toLowerCase().includes(filter.toLowerCase()) && (state === 'all' || (state === 'archived' ? !!row.archived : state === 'active' ? !row.archived : row.status === state)))
  const load = useCallback(async () => {
    if (!site) return
    const id = ++request.current
    setLoading(true)
    try {
      const data = await crmRead<Report>(`${api}/crm/fundraising?${new URLSearchParams({ site, mode: 'workspace' })}`)
      if (id === request.current) { setReport(data); setError(''); setLoading(false) }
    } catch (cause) { if (id === request.current) { setReport(null); setError((cause as Error).message); setLoading(false) } }
  }, [api, site])
  useEffect(() => { void load() }, [load, refresh])
  useEffect(() => { setPage(0); setFilter(''); setState('all'); setTab('Overview') }, [kind, site])
  useEffect(() => { if (creating) { setValues({ ...empty(), campaignId: campaignParam }); setDirty(false) } }, [creating, site, campaignParam])
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => { if (dirty || saving) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', before); return () => window.removeEventListener('beforeunload', before)
  }, [dirty, saving])
  useEffect(() => {
    if (!creating || !site) return
    const controller = new AbortController()
    void crmRead<{ docs: Array<{ id: string; label: string }> }>(`${api}/crm/fundraising?${new URLSearchParams({ site, mode: 'candidates', search: contactSearch })}`, { signal: controller.signal })
      .then(data => setCandidates(data.docs)).catch(() => { if (!controller.signal.aborted) setCandidates([]) })
    return () => controller.abort()
  }, [creating, api, site, contactSearch])
  const url = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search)
    next.set('view', 'fundraising'); next.set('site', site)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    return `${admin}/crm?${next}`
  }
  const navigate = (changes: Record<string, string | null>) => {
    if (saving || (dirty && !window.confirm('Discard unsaved fundraising changes?'))) return
    setDirty(false); setDialog(false); setTab('Overview'); setError(''); router.push(url(changes))
  }
  const set = <K extends keyof Values>(key: K, value: Values[K]) => { setValues(v => ({ ...v, [key]: value })); setDirty(true); operation.current = null }
  const edit = (row?: RecordRow) => {
    setValues(row ? { name: row.name, description: row.description, startsOn: row.starts_on || '', endsOn: row.ends_on || '', currency: row.currency || 'USD', exponent: row.exponent ?? 2, goalAmount: row.goal_minor ? formatMinor(row.goal_minor, row.exponent || 0) : '', archived: !!row.archived, campaignId: row.campaign_id || '', defaultFundId: row.default_fund_id || '', status: row.status || 'draft', channel: row.channel || 'email', sendOn: row.send_on || '', internalCode: row.internal_code || '', fundIds: report?.links.filter(l => l.campaign_id === row.id).map(l => l.fund_id) || [], recipientIds: [] } : empty())
    setDialog(true); setDirty(false); setError(''); operation.current = null
  }
  const save = async (override?: Values) => {
    if (saving || !site) return
    const current = override || values
    let goalMinor = ''
    try { if (kind !== 'funds' && current.goalAmount.trim()) goalMinor = parseMoney(current.goalAmount.trim(), { code: current.currency, exponent: current.exponent }).minorUnits }
    catch (cause) { setError((cause as Error).message); return }
    const payload = { action: 'save', site, kind, id: selected?.id, expectedRevision: selected?.revision, values: { ...current, goalMinor, recipientIds: kind === 'appeals' && (!selected || override) ? current.recipientIds : undefined } }
    const fingerprint = JSON.stringify(payload)
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, key: crypto.randomUUID() }
    setSaving(true); setError('')
    try {
      const result = await crmRead<{ doc: { id: string } }>(`${api}/crm/fundraising`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, operationKey: operation.current.key }) })
      operation.current = null; setDirty(false); setDialog(false); setNotice('Saved.'); setRefresh(n => n + 1)
      router.push(url({ resultType: kind, result: result.doc.id, fundraisingMode: null, campaign: null }))
    } catch (cause) { setError((cause as Error).message) } finally { setSaving(false) }
  }
  const refreshAudience = async () => {
    if (!selected || selected.status !== 'draft' || !report || saving) return
    let preview: { changes: Array<{ label: string; before: string; after: string }>; selected: number; eligible: number }
    try { preview = await crmRead(`${api}/crm/fundraising?${new URLSearchParams({ mode: 'audience-preview', site, appeal: selected.id })}`) }
    catch (cause) { setError((cause as Error).message); return }
    const details = preview.changes.slice(0, 8).map(change => `${change.label}: ${change.before} → ${change.after}`).join('\n')
    if (!window.confirm(`Refresh this draft audience? ${preview.eligible} of ${preview.selected} would be eligible.\n${details || 'No eligibility changes.'}${preview.changes.length > 8 ? `\n…and ${preview.changes.length - 8} more changes.` : ''}\nPrevious snapshots are retained.`)) return
    const current: Values = { name: selected.name, description: selected.description, startsOn: selected.starts_on || '', endsOn: selected.ends_on || '', currency: selected.currency || 'USD', exponent: selected.exponent ?? 2, goalAmount: selected.goal_minor ? formatMinor(selected.goal_minor, selected.exponent || 0) : '', archived: !!selected.archived, campaignId: selected.campaign_id || '', defaultFundId: selected.default_fund_id || '', status: selected.status || 'draft', channel: selected.channel || 'email', sendOn: selected.send_on || '', internalCode: '', fundIds: [], recipientIds: report.recipients.filter(r => r.appeal_id === selected.id).map(r => r.constituent_id) }
    void save(current)
  }
  const recordOutreach = async () => {
    if (!selected || saving || !outreachNotes.trim()) return
    setSaving(true); setError('')
    try {
      await crmRead(`${api}/crm/fundraising`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'record-outreach', site, appeal: selected.id, expectedRevision: selected.revision, notes: outreachNotes, occurredAt: `${outreachDate}T12:00:00.000Z`, operationKey: crypto.randomUUID() }) })
      setOutreachNotes(''); setDirty(false); setNotice('Outreach recorded.'); setRefresh(n => n + 1)
    } catch (cause) { setError((cause as Error).message) } finally { setSaving(false) }
  }
  const create = () => kind === 'appeals' ? navigate({ resultType: 'appeals', fundraisingMode: 'create', result: null, campaign: null }) : edit()
  const form = <form className="vc-fund-form" onSubmit={event => { event.preventDefault(); void save() }}>
    <section className="vc-fund-card"><h2>{kind === 'appeals' ? '1 · Connect the ask' : `${kind === 'funds' ? 'Fund' : 'Campaign'} details`}</h2><div className="vc-fund-fields">
      <label>Name<input required maxLength={180} value={values.name} onChange={e => set('name', e.target.value)} /></label>
      {kind === 'appeals' && <><label>Campaign<select required={!selected} value={values.campaignId} onChange={e => set('campaignId', e.target.value)}><option value="">Select campaign</option>{report?.campaigns.filter(c => !c.archived).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Default designation<select value={values.defaultFundId} onChange={e => set('defaultFundId', e.target.value)}><option value="">None</option>{report?.funds.filter(f => !f.archived).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label></>}
      {kind === 'funds' && <label>Internal code<input maxLength={60} value={values.internalCode} onChange={e => set('internalCode', e.target.value)} /></label>}
      <label className="vc-fund-wide">Description<textarea maxLength={4000} value={values.description} onChange={e => set('description', e.target.value)} /></label>
      {kind !== 'funds' && <><label>Start date<input type="date" value={values.startsOn} onChange={e => set('startsOn', e.target.value)} /></label><label>End date<input type="date" value={values.endsOn} onChange={e => set('endsOn', e.target.value)} /></label><label>Currency<input maxLength={3} value={values.currency} onChange={e => set('currency', e.target.value.toUpperCase())} /></label><label>Decimal places<input type="number" min="0" max="4" value={values.exponent} onChange={e => set('exponent', Number(e.target.value))} /></label><label>Goal (optional)<input inputMode="decimal" value={values.goalAmount} onChange={e => set('goalAmount', e.target.value)} /></label></>}
      {kind === 'appeals' && <label>Status<select value={values.status} onChange={e => set('status', e.target.value)}>{['draft','planned','in_progress','completed','cancelled'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></label>}
      <label className="vc-fund-check"><input type="checkbox" checked={values.archived} onChange={e => set('archived', e.target.checked)} />Archived</label>
    </div></section>
    {kind === 'campaigns' && <section className="vc-fund-card"><h2>Linked funds</h2><p>Funds can support several campaigns. These links do not designate gifts.</p><div className="vc-fund-check-list">{report?.funds.filter(f => !f.archived).map(f => <label key={f.id} className="vc-fund-check"><input type="checkbox" checked={values.fundIds.includes(f.id)} onChange={e => set('fundIds', e.target.checked ? [...values.fundIds, f.id] : values.fundIds.filter(id => id !== f.id))} />{f.name}</label>)}</div></section>}
    {creating && <><section className="vc-fund-card"><h2>2 · Choose your audience</h2><p>Manual contact selection is available. Saved contact reports are not available yet.</p><label>Find contacts<input value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="Search contacts" /></label><div className="vc-fund-check-list" aria-label="Manual recipients">{candidates.map(c => <label key={c.id} className="vc-fund-check"><input type="checkbox" checked={values.recipientIds.includes(c.id)} onChange={e => set('recipientIds', e.target.checked ? [...values.recipientIds, c.id] : values.recipientIds.filter(id => id !== c.id))} />{c.label}</label>)}</div><p>{values.recipientIds.length} selected. Preferences and primary contact methods are checked when the draft is saved.</p></section><section className="vc-fund-card"><h2>3 · Plan the outreach</h2><div className="vc-fund-fields"><label>Channel<select value={values.channel} onChange={e => set('channel', e.target.value)}><option value="email">Email</option><option value="phone">Phone</option><option value="mail">Postal mail</option></select></label><label>Planned date<input type="date" value={values.sendOn} onChange={e => set('sendOn', e.target.value)} /></label></div><p>Creating a draft never sends correspondence.</p></section></>}
    <div className="vc-fund-form-actions"><button type="button" onClick={() => creating ? navigate({ fundraisingMode: null }) : setDialog(false)}>Cancel</button><button type="submit" className="vc-crm-primary" disabled={saving || !report?.canEdit}>{saving ? 'Saving…' : creating ? 'Create draft appeal' : 'Save'}</button></div>
  </form>
  return <Gutter className="vc-crm vc-crm-domain vc-crm-collection vc-fundraising">
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {creating ? <><button className="vc-fund-back" onClick={() => navigate({ fundraisingMode: null })}>← Fundraising</button><h1>Create appeal</h1><p>Connect a campaign, choose contacts, and save an outreach draft.</p>{form}</> : selected ? <>
      <button className="vc-fund-back" onClick={() => navigate({ result: null, resultType: null })}>← Fundraising / {labels[kind]}</button>
      <div className="vc-fund-heading"><div><h1>{selected.name}</h1><p>{kind === 'funds' ? selected.description : dates(selected)} · {selected.archived ? 'Archived' : selected.status || 'Active'}</p></div><div className="vc-fund-actions">{currencies.length > 1 && <label>Currency<select value={activeCurrency} onChange={e => setCurrency(e.target.value)}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>}{kind === 'campaigns' && report?.canEdit && <button className="vc-crm-primary" onClick={() => navigate({ resultType: 'appeals', result: null, fundraisingMode: 'create', campaign: selected.id })}>+ Create appeal</button>}{report?.canEdit && <button onClick={() => edit(selected)}>Edit {kind.slice(0,-1)}</button>}</div></div>
      {kind === 'campaigns' && <div className="vc-fund-metrics"><div className="vc-fund-card"><small>Received · {activeCurrency || 'No currency'}</small><strong>{money(sum(selected.received, activeCurrency))}</strong><progress max="100" value={pct(selected, activeCurrency)} /><small>{selected.goal_minor && selected.currency === activeCurrency ? `${pct(selected, activeCurrency)}% of ${money({ currency: activeCurrency, exponent: selected.exponent || 0, minor: selected.goal_minor })} goal` : 'No goal in this currency'}</small></div><div className="vc-fund-card"><small>Outstanding pledges</small><strong>{money(sum(selected.outstanding, activeCurrency))}</strong></div><div className="vc-fund-card"><small>Appeals</small><strong>{selected.appealCount || 0}</strong></div></div>}
      <nav className="vc-crm-toolbar" aria-label={`${kind} workspace`}>{(kind === 'campaigns' ? ['Overview','Appeals','Donations','Funds','Tasks'] : kind === 'funds' ? ['Overview','Donations','Related campaigns','Activity'] : ['Overview','Audience','Donations','Tasks','Correspondence']).map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</nav>
      {tab === 'Overview' && <div className="vc-fund-detail-grid"><section className="vc-fund-card"><h2>{kind === 'funds' ? 'Donation designation' : kind === 'appeals' ? 'Appeal details' : 'Campaign overview'}</h2><p>{selected.description || 'No description yet.'}</p>{kind === 'funds' && <p>Internal code: {selected.internal_code || '—'}</p>}{kind === 'appeals' && <><p>Campaign: {report?.campaigns.find(c => c.id === selected.campaign_id)?.name || 'Unassigned historical appeal'}</p><p>Default designation: {report?.funds.find(f => f.id === selected.default_fund_id)?.name || 'None'}</p><p>Channel: {selected.channel} · Planned: {selected.send_on || 'Not set'}</p>{report?.canSeeAudience && <p>Audience: {selected.audience?.eligible || 0} eligible of {selected.audience?.selected || 0} selected</p>}</>}</section><section className="vc-fund-card"><h2>Received giving</h2>{selected.received.length ? selected.received.map(t => <p key={t.currency}><strong>{money(t)}</strong></p>) : <p>No posted monetary gifts attributed yet.</p>}<small>Net of corrections and refunds. This is not a cash balance.</small></section>{kind === 'campaigns' && <section className="vc-fund-card"><h2>Recent activity</h2>{report?.activity.filter(event => event.record_id === selected.id || (event.record_type === 'appeals' && report.appeals.some(a => a.id === event.record_id && a.campaign_id === selected.id))).slice(0,5).map(event => <p key={`${event.record_id}:${event.created_at}`}>{event.action} · {event.created_at.slice(0,16).replace('T',' ')}</p>)}</section>}</div>}
      {tab === 'Appeals' && <section className="vc-fund-card"><h2>Appeals supporting this campaign</h2><div className="vc-crm-table-wrap"><table><thead><tr><th>Appeal</th><th>Channel</th><th>Status</th><th>Recipients</th><th>Received</th></tr></thead><tbody>{report?.appeals.filter(a => a.campaign_id === selected.id).map(a => <tr key={a.id}><td><button onClick={() => navigate({ resultType: 'appeals', result: a.id })}>{a.name}</button></td><td>{a.channel}</td><td>{a.status}</td><td>{a.audience?.eligible || 0}</td><td>{money(sum(a.received, activeCurrency))}</td></tr>)}</tbody></table></div>{!selected.appealCount && <p>No appeals linked yet.</p>}</section>}
      {(tab === 'Funds' || tab === 'Related campaigns') && <section className="vc-fund-card"><h2>{tab === 'Funds' ? 'Linked shared funds' : 'Related campaigns'}</h2>{tab === 'Funds' ? report?.links.filter(l => l.campaign_id === selected.id).map(l => { const row = report.funds.find(f => f.id === l.fund_id); return row && <p key={row.id}><button onClick={() => navigate({ resultType: 'funds', result: row.id })}>{row.name}</button></p> }) : report?.links.filter(l => l.fund_id === selected.id).map(l => { const row = report.campaigns.find(c => c.id === l.campaign_id); return row && <p key={row.id}><button onClick={() => navigate({ resultType: 'campaigns', result: row.id })}>{row.name}</button> · {activeCurrency ? money({ currency: activeCurrency, exponent: sum(row.received, activeCurrency)?.exponent || 2, minor: report.gifts.filter(g => g.campaign_id === row.id && g.currency === activeCurrency).flatMap(g => g.funds.filter(f => f.id === selected.id).map(f => f.minor)).reduce((total, minor) => total + BigInt(minor), 0n).toString() }) : 'No currency'} received for this fund</p> })}<p>These links do not change actual gift designations.</p></section>}
      {tab === 'Audience' && <section className="vc-fund-card"><div className="vc-fund-heading"><h2>Recipient snapshot</h2>{report?.canSeeAudience && report.canSeeNames && selected.status === 'draft' && report.canEdit && <button onClick={() => void refreshAudience()} disabled={saving}>Refresh eligibility</button>}</div>{report?.canSeeAudience ? <><p>{selected.audience?.eligible || 0} eligible · {(selected.audience?.selected || 0) - (selected.audience?.eligible || 0)} excluded</p>{report.recipients.filter(r => r.appeal_id === selected.id).map(r => <p key={r.constituent_id}>{r.label} · {r.eligible ? 'Eligible when selected' : r.exclusion}</p>)}{!selected.audience?.selected && <p>No recipients selected.</p>}<p>Refresh retains prior snapshots. Eligibility must be rechecked again before sending.</p></> : <p>Recipient information requires communications read access.</p>}</section>}
      {tab === 'Donations' && <section className="vc-fund-card"><h2>Attributed donations</h2><div className="vc-crm-table-wrap"><table><thead><tr><th>Donor</th><th>Date</th><th>{kind === 'funds' ? 'Net fund allocation' : 'Net gift'}</th><th>Campaign</th><th>Appeal</th></tr></thead><tbody>{report?.gifts.filter(g => kind === 'campaigns' ? g.campaign_id === selected.id : kind === 'appeals' ? g.appeal_id === selected.id : g.funds.some(f => f.id === selected.id)).map(g => <tr key={g.id}><td><button onClick={() => router.push(`${admin}/crm?${new URLSearchParams({ view: 'donations', site, result: g.id })}`)}>{g.label}</button></td><td>{g.received_on}</td><td>{money({ currency: g.currency, exponent: g.exponent, minor: kind === 'funds' ? g.funds.find(f => f.id === selected.id)?.minor || '0' : g.net_minor })}</td><td>{report.campaigns.find(c => c.id === g.campaign_id)?.name || 'Direct'}</td><td>{report.appeals.find(a => a.id === g.appeal_id)?.name || '—'}</td></tr>)}</tbody></table></div></section>}
      {tab === 'Tasks' && <section className="vc-fund-card"><h2>Tasks</h2><RecordTasks api={api} admin={admin} site={site} link={{ type: kind === 'campaigns' ? 'campaign' : 'appeal', id: selected.id }} onDirty={setDirty} onSaving={setSaving} /></section>}
      {tab === 'Correspondence' && <section className="vc-fund-card"><h2>Correspondence and outreach</h2><p>Appeal drafts do not send messages. Use the correspondence workspace for actual messages. Record completed external outreach below.</p><button onClick={() => router.push(`${admin}/crm?${new URLSearchParams({ view: 'correspondence', site })}`)}>Open correspondence</button>{report?.outreach.filter(event => event.appeal_id === selected.id).map(event => <p key={event.id}>{event.occurred_at.slice(0,10)} · {event.channel} · {event.recipient_count} recipients · {event.notes}</p>)}{report?.canRecordOutreach && !selected.archived && <div className="vc-fund-fields"><label>Date<input type="date" value={outreachDate} onChange={e => setOutreachDate(e.target.value)} /></label><label>Record external outreach<textarea value={outreachNotes} maxLength={2000} onChange={e => { setOutreachNotes(e.target.value); setDirty(true) }} placeholder="What was sent or recorded outside this workspace?" /></label><button disabled={saving || !outreachNotes.trim()} onClick={() => void recordOutreach()}>Record outreach</button></div>}</section>}
      {tab === 'Activity' && <section className="vc-fund-card"><h2>Activity</h2>{report?.activity.filter(event => event.record_type === 'funds' && event.record_id === selected.id).map(event => <p key={`${event.record_id}:${event.created_at}`}>{event.action} · {event.created_at.slice(0,16).replace('T',' ')}</p>)}{!report?.activity.some(event => event.record_type === 'funds' && event.record_id === selected.id) && <p>No recent fund activity.</p>}</section>}
    </> : <><div className="vc-fund-heading"><div><h1>Fundraising</h1><p>Track goals, organize asks, and see where gifts are designated.</p></div>{report?.canEdit && <button className="vc-crm-primary" onClick={create}>+ Create {kind.slice(0,-1)}</button>}</div>
      <nav className="vc-crm-toolbar" aria-label="Fundraising sections">{(['campaigns','appeals','funds'] as const).map(next => <button key={next} aria-pressed={kind === next} onClick={() => navigate({ fundraisingKind: next, resultType: null, result: null, fundraisingMode: null, campaign: null })}>{labels[next]}</button>)}</nav>
      <div className="vc-fund-metrics"><div className="vc-fund-card"><small>Received · {activeCurrency || 'No currency'}</small><strong>{money(sum(report?.totals, activeCurrency))}</strong><small>All posted monetary gifts in this site, net of adjustments.</small></div><div className="vc-fund-card"><small>Active campaigns</small><strong>{report?.campaigns.filter(c => !c.archived).length || 0}</strong></div><div className="vc-fund-card"><small>Appeals in progress</small><strong>{report?.appeals.filter(a => a.status === 'in_progress').length || 0}</strong></div></div>
      <section className="vc-fund-card"><div className="vc-fund-heading"><h2>{labels[kind]}</h2><div className="vc-fund-filters"><label>Search<input value={filter} onChange={e => { setFilter(e.target.value); setPage(0) }} placeholder={`Search ${kind}`} /></label><label>Status<select value={state} onChange={e => { setState(e.target.value); setPage(0) }}><option value="all">All</option><option value="active">Active</option><option value="archived">Archived</option>{kind === 'appeals' && ['draft','planned','in_progress','completed','cancelled'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}</select></label>{currencies.length > 1 && <label>Currency<select value={activeCurrency} onChange={e => setCurrency(e.target.value)}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>}</div></div><div className="vc-crm-table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>{kind === 'funds' ? 'Purpose' : 'Dates'}</th><th>Received {activeCurrency && `(${activeCurrency})`}</th><th>{kind === 'campaigns' ? 'Progress' : kind === 'appeals' ? 'Recipients' : 'Campaigns'}</th><th>{kind === 'campaigns' ? 'Appeals · Funds' : 'Details'}</th></tr></thead><tbody>{filtered.slice(page * 25, page * 25 + 25).map(row => <tr key={row.id}><td><button onClick={() => navigate({ resultType: kind, result: row.id })}>{row.name}</button></td><td>{row.archived ? 'Archived' : kind === 'appeals' ? row.status?.replace('_',' ') : 'Active'}</td><td>{kind === 'funds' ? row.description || '—' : dates(row)}</td><td>{money(sum(row.received, activeCurrency))}</td><td>{kind === 'campaigns' ? <><strong>{pct(row, activeCurrency)}%</strong><progress max="100" value={pct(row, activeCurrency)} /></> : kind === 'appeals' ? row.audience?.eligible || 0 : row.campaignCount || 0}</td><td>{kind === 'campaigns' ? `${row.appealCount || 0} appeals · ${row.fundCount || 0} funds` : <button onClick={() => navigate({ resultType: kind, result: row.id })}>View</button>}</td></tr>)}</tbody></table></div>{!filtered.length && <p>No {kind} match. {report?.canEdit && 'Use Create to add one.'}</p>}{filtered.length > 25 && <div className="vc-fund-pager"><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(filtered.length / 25)}</span><button disabled={(page + 1) * 25 >= filtered.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}</section>
      {kind === 'campaigns' && <section className="vc-fund-card"><div className="vc-fund-heading"><h2>Upcoming appeals</h2><button onClick={() => navigate({ fundraisingKind: 'appeals' })}>View all appeals →</button></div>{report?.appeals.filter(a => !a.archived && a.send_on && a.send_on >= report.asOf && !['completed','cancelled'].includes(a.status || '')).slice(0, 5).map(a => <p key={a.id}><button onClick={() => navigate({ resultType: 'appeals', result: a.id })}>{a.name}</button> · {report.campaigns.find(c => c.id === a.campaign_id)?.name || 'Unassigned'} · {a.send_on} · {a.audience?.eligible || 0} eligible</p>)}{!report?.appeals.some(a => !a.archived && a.send_on && a.send_on >= report.asOf && !['completed','cancelled'].includes(a.status || '')) && <p>No upcoming appeals scheduled.</p>}</section>}
    </>}
    {loading && <p role="status">Loading fundraising records…</p>}
    {dialog && <CRMEditorDialog title={`${selected ? 'Edit' : 'Create'} ${kind.slice(0,-1)}`} onDismiss={() => { if (!dirty || window.confirm('Discard unsaved fundraising changes?')) { setDialog(false); setDirty(false) } }}>{form}</CRMEditorDialog>}
  </Gutter>
}
