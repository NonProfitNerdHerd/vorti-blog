'use client'
import { RecordAttachmentLink } from './RecordAttachmentLink'
/* eslint-disable react-hooks/set-state-in-effect -- Request lifecycle state follows the existing CRM widgets. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseMoney } from './money'
import type { GiftKind, GiftSummary } from './finance'
import { ClassificationPicker } from './ClassificationPicker'
import { GiftAttribution } from './GiftAttribution'

type Page = { docs: GiftSummary[]; total: number; canEdit: boolean; canConfigure: boolean }
type Detail = GiftSummary & {
  adjustments: Array<{
    id: string
    action: string
    deltaMinor: string
    reason: string
    actorLabel: string
    createdAt: string
  }>
  adjustmentTotal: number
  adjustmentPage: number
  canEdit: boolean
}
type Fund = { id: string; name: string }
function amountLabel(minor: string, exponent: number): string {
  const sign = minor.startsWith('-') ? '-' : '',
    digits = minor.replace(/^-/, '').padStart(exponent + 1, '0')
  return sign + (exponent ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}` : digits)
}
export function ContactGifts({
  api,
  site,
  contact,
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  contact: string
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
}) {
  const [page, setPage] = useState(1),
    [result, setResult] = useState<Page | null>(null),
    [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(''),
    [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false),
    [detail, setDetail] = useState<Detail | null>(null),
    [funds, setFunds] = useState<Fund[]>([]),
    [fundNext, setFundNext] = useState<Fund | null>(null)
  const [amount, setAmount] = useState(''),
    [currency, setCurrency] = useState('USD'),
    [exponent, setExponent] = useState(2),
    [kind, setKind] = useState<GiftKind>('cash')
  const [campaign, setCampaign] = useState(''), [appeal, setAppeal] = useState('')
  const [attributionDirty, setAttributionDirty] = useState(false)
  const [primaryAllocation, setPrimaryAllocation] = useState(''), [splitAllocations, setSplitAllocations] = useState<Array<{ id: string; fund: string; amount: string }>>([])
  const [receivedOn, setReceivedOn] = useState(''),
    [fund, setFund] = useState(''),
    [reference, setReference] = useState(''),
    [notes, setNotes] = useState(''),
    [newFund, setNewFund] = useState('')
  const [adjustment, setAdjustment] = useState<'refund' | 'correction' | 'void'>('refund'),
    [delta, setDelta] = useState(''),
    [reason, setReason] = useState('')
  const operation = useRef<string | null>(null),
    generation = useRef(0)
  const request = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { ...init, cache: 'no-store' }),
      data = (await response.json()) as { message?: string }
    if (!response.ok)
      throw Object.assign(new Error(data.message || 'Unable to load financial records.'), {
        status: response.status,
      })
    return data as T
  }, [])
  const changed = (): void => {
    operation.current = null
    onDirty(true)
  }
  const clear = useCallback((): void => {
    generation.current++
    setResult(null)
    setDetail(null)
    setFunds([])
    setCreating(false)
    setAmount('')
    setDelta('')
    setReason('')
    setReference('')
    setNotes('')
    setNewFund('')
    setCampaign('')
    setAppeal('')
    setPrimaryAllocation('')
    setSplitAllocations([])
    onDirty(false)
  }, [onDirty])
  const loadFunds = async (after?: Fund): Promise<void> => {
    const query = new URLSearchParams({ site, view: 'funds' })
    if (after) {
      query.set('afterID', after.id)
      query.set('afterName', after.name)
    }
    const response = await request<{ docs: Fund[]; next: Fund | null }>(
      `${api}/crm/finance?${query}`,
    )
    setFunds((previous) => (after ? [...previous, ...response.docs] : response.docs))
    setFundNext(response.next)
  }
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    void request<Page>(
      `${api}/crm/finance?${new URLSearchParams({ site, constituent: contact, page: String(page) })}`,
    )
      .then(
        (data) => {
          if (current) setResult(data)
        },
        (cause) => {
          if (!current) return
          if ([401, 403].includes(Number(cause.status))) clear()
          setResult(null)
          setError(cause.message)
        },
      )
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [api, site, contact, page, refresh, request, clear])
  useEffect(() => {
    const focus = (): void => {
      setRefresh((value) => value + 1)
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])
  const mutate = async (body: Record<string, unknown>): Promise<boolean> => {
    setSaving(true)
    onSaving(true)
    setError('')
    operation.current ||= crypto.randomUUID()
    try {
      await request(`${api}/crm/finance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, site, operationKey: operation.current }),
      })
      operation.current = null
      onDirty(false)
      setRefresh((value) => value + 1)
      setNotice(
        body.action === 'create-fund'
          ? 'Fund was created.'
          : body.action === 'create-gift'
            ? 'Gift was recorded.'
            : 'Gift adjustment was recorded.',
      )
      return true
    } catch (cause) {
      if (
        cause &&
        typeof cause === 'object' &&
        'status' in cause &&
        [401, 403].includes(Number(cause.status))
      )
        clear()
      setError(cause instanceof Error ? cause.message : 'Unable to save the financial record.')
      return false
    } finally {
      setSaving(false)
      onSaving(false)
    }
  }
  const open = async (id: string, historyPage = 1, saved = false): Promise<void> => {
    if (!saved && (reason || delta) && !window.confirm('Discard this adjustment?')) return
    setError('')
    const version = generation.current
    try {
      const data = await request<{ doc: Detail }>(
        `${api}/crm/finance?${new URLSearchParams({ site, id, page: String(historyPage) })}`,
      )
      if (version !== generation.current) return
      setDetail(data.doc)
      setDelta('')
      setReason('')
      operation.current = null
    } catch (cause) {
      if (
        cause &&
        typeof cause === 'object' &&
        'status' in cause &&
        [401, 403].includes(Number(cause.status))
      )
        clear()
      setError(cause instanceof Error ? cause.message : 'Unable to load the gift.')
    }
  }
  const create = async (): Promise<void> => {
    try {
      const money = parseMoney(amount, { code: currency, exponent })
      if (!fund) throw new Error('Choose a fund.')
      if (
        await mutate({
          action: 'create-gift',
          constituent: contact,
          amount: money,
          exponent,
          kind,
          receivedOn,
          reference,
          notes,
          allocations: splitAllocations.length ? [
            { ...parseMoney(primaryAllocation, { code: currency, exponent }), fund },
            ...splitAllocations.map(row => ({ ...parseMoney(row.amount, { code: currency, exponent }), fund: row.fund })),
          ] : [{ ...money, fund }],
          campaign,
          appeal,
        })
      ) {
        setCreating(false)
        setAmount('')
        setNotes('')
        setReference('')
        setCampaign('')
        setAppeal('')
        setPrimaryAllocation('')
        setSplitAllocations([])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enter a valid gift amount.')
    }
  }
  const applyAdjustment = async (): Promise<void> => {
    if (!detail) return
    try {
      const deltaMinor =
        adjustment === 'void'
          ? '0'
          : parseMoney(delta, { code: detail.currency, exponent: detail.exponent }).minorUnits
      if (
        await mutate({
          action: 'adjust-gift',
          id: detail.id,
          adjustment,
          deltaMinor,
          reason,
          expectedRevision: detail.revision,
        })
      )
        await open(detail.id, 1, true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enter a valid adjustment.')
    }
  }
  return (
    <section aria-label="Chapter gifts">
      <div className="vc-crm-toolbar">
        <h3>Chapter gifts</h3>
        {result?.canEdit && (
          <button
            type="button"
            disabled={saving || creating || !!detail}
            onClick={() => {
              setCreating(true)
              setError('')
              void loadFunds().catch((cause) => setError(cause.message))
            }}
          >
            Record gift
          </button>
        )}
      </div>
      <p>
        Cash gifts and in-kind estimates are recorded separately. Originals are retained; refunds,
        corrections and voids require a reason.
      </p>
      {notice && (
        <p className="vc-crm-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            Retry list
          </button>
        </p>
      )}
      {creating && (
        <fieldset disabled={saving} className="vc-crm-fields">
          <legend>Record a gift</legend>
          <ClassificationPicker api={api} site={site} kind="campaigns" value={campaign} onChange={value => { setCampaign(value); changed() }} />
          <ClassificationPicker api={api} site={site} kind="appeals" value={appeal} onChange={value => { setAppeal(value); changed() }} />
          <label>
            Amount
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                changed()
              }}
            />
          </label>
          <label>
            Currency (three-letter code)
            <input
              maxLength={3}
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value.toUpperCase())
                changed()
              }}
            />
          </label>
          <label>
            Currency decimal places
            <select
              value={exponent}
              onChange={(event) => {
                setExponent(Number(event.target.value))
                changed()
              }}
            >
              {[0, 1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Gift type
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as GiftKind)
                changed()
              }}
            >
              {(['cash', 'check', 'external-online', 'in-kind'] as const).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Received on
            <input
              type="date"
              value={receivedOn}
              onChange={(event) => {
                setReceivedOn(event.target.value)
                changed()
              }}
            />
          </label>
          <label>
            Fund
            <select
              value={fund}
              onChange={(event) => {
                setFund(event.target.value)
                changed()
              }}
            >
              <option value="">Choose fund…</option>
              {funds.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                </option>
              ))}
            </select>
          </label>
          {splitAllocations.length > 0 && <label>First fund allocation amount<input inputMode="decimal" value={primaryAllocation} onChange={event => { setPrimaryAllocation(event.target.value); changed() }} /></label>}
          {splitAllocations.map((row, index) => <fieldset key={row.id}><legend>Additional allocation {index + 1}</legend>
            <label>Allocation fund<select value={row.fund} onChange={event => { setSplitAllocations(rows => rows.map(r => r.id === row.id ? { ...r, fund: event.target.value } : r)); changed() }}><option value="">Choose fund…</option>{funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <label>Allocation amount<input inputMode="decimal" value={row.amount} onChange={event => { setSplitAllocations(rows => rows.map(r => r.id === row.id ? { ...r, amount: event.target.value } : r)); changed() }} /></label>
            <button type="button" onClick={() => { setSplitAllocations(rows => rows.filter(r => r.id !== row.id)); changed() }}>Remove allocation</button>
          </fieldset>)}
          <button type="button" disabled={splitAllocations.length >= 19} onClick={() => { setSplitAllocations(rows => [...rows, { id: crypto.randomUUID(), fund: '', amount: '' }]); changed() }}>Split across another fund</button>
          {splitAllocations.length > 0 && <p>All allocation amounts must add up to the full gift amount. Each fund can appear once.</p>}
          {fundNext && (
            <button
              type="button"
              onClick={() => void loadFunds(fundNext).catch((cause) => setError(cause.message))}
            >
              Load more funds
            </button>
          )}
          <label>
            Reference
            <input
              maxLength={250}
              value={reference}
              onChange={(event) => {
                setReference(event.target.value)
                changed()
              }}
            />
          </label>
          <label>
            Notes
            <textarea
              maxLength={4000}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value)
                changed()
              }}
            />
          </label>
          {result?.canConfigure && (
            <div>
              <label>
                New fund name
                <input
                  maxLength={120}
                  value={newFund}
                  onChange={(event) => {
                    setNewFund(event.target.value)
                    changed()
                  }}
                />
              </label>
              <button
                type="button"
                disabled={!newFund.trim()}
                onClick={() =>
                  void (async () => {
                    if (await mutate({ action: 'create-fund', name: newFund })) {
                      setNewFund('')
                      onDirty(Boolean(amount || notes || reference || receivedOn || fund))
                      await loadFunds()
                    }
                  })().catch((cause) => setError(cause.message))
                }
              >
                Create fund
              </button>
            </div>
          )}
          <div className="vc-crm-toolbar">
            <button className="vc-crm-primary" type="button" onClick={() => void create()}>
              Save gift
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Discard this gift entry?')) {
                  setCreating(false)
                  setAmount('')
                  setNotes('')
                  setReference('')
                  setReceivedOn('')
                  setNewFund('')
                  onDirty(false)
                  operation.current = null
                }
              }}
            >
              Cancel gift
            </button>
          </div>
        </fieldset>
      )}
      <div className="vc-crm-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Received</th>
              <th>Amount</th>
              <th>Net amount</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {result?.docs.map((gift) => (
              <tr key={gift.id}>
                <td>
                  <button
                    className="vc-crm-title"
                    type="button"
                    disabled={creating || saving}
                    onClick={() => void open(gift.id)}
                  >
                    {gift.receivedOn}
                  </button>
                </td>
                <td>
                  {gift.currency} {amountLabel(gift.originalMinor, gift.exponent)}
                </td>
                <td>
                  {gift.currency} {amountLabel(gift.netMinor, gift.exponent)}
                </td>
                <td>{gift.kind}</td>
                <td>{gift.state}</td>
              </tr>
            ))}
            {!result?.docs.length && (
              <tr>
                <td colSpan={5}>{loading ? 'Loading gifts…' : 'No gifts recorded.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="vc-crm-toolbar">
        <span>
          {result?.total || 0} gifts · Page {page}
        </span>
        <button
          type="button"
          disabled={page <= 1 || loading || creating || !!detail}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!result || page * 50 >= result.total || loading || creating || !!detail}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </div>
      {detail && (
        <section aria-label="Gift details">
          <GiftAttribution key={detail.id} api={api} site={site} gift={detail.id} onDirty={value => { setAttributionDirty(value); onDirty(value || !!reason || !!delta) }} onSaving={value => { setSaving(value); onSaving(value) }} />
          <div className="vc-crm-toolbar">
            <h3>Gift on {detail.receivedOn}</h3>
            <RecordAttachmentLink site={site} link={{ type: 'gift', id: detail.id }} />
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if ((!reason && !delta && !attributionDirty) || window.confirm('Discard unsaved gift changes?')) {
                  setDetail(null)
                  setReason('')
                  setDelta('')
                  setAttributionDirty(false)
                  onDirty(false)
                  operation.current = null
                }
              }}
            >
              Close gift
            </button>
          </div>
          <p>
            {detail.reference || 'No reference'} · {detail.notes || 'No notes'}
          </p>
          <h4>Adjustment history</h4>
          <div className="vc-crm-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {detail.adjustments.map((row) => (
                  <tr key={row.id}>
                    <td>{row.action}</td>
                    <td>
                      {detail.currency} {amountLabel(row.deltaMinor, detail.exponent)}
                    </td>
                    <td>{row.reason}</td>
                    <td>{row.actorLabel}</td>
                  </tr>
                ))}
                {!detail.adjustments.length && (
                  <tr>
                    <td colSpan={4}>No adjustments.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="vc-crm-toolbar">
            <span>
              {detail.adjustmentTotal} adjustments · Page {detail.adjustmentPage}
            </span>
            <button
              type="button"
              disabled={detail.adjustmentPage <= 1 || saving || !!reason || !!delta}
              onClick={() => void open(detail.id, detail.adjustmentPage - 1)}
            >
              Previous history
            </button>
            <button
              type="button"
              disabled={
                detail.adjustmentPage * 50 >= detail.adjustmentTotal ||
                saving ||
                !!reason ||
                !!delta
              }
              onClick={() => void open(detail.id, detail.adjustmentPage + 1)}
            >
              Next history
            </button>
          </div>
          {detail.canEdit && detail.state === 'posted' && (
            <fieldset disabled={saving}>
              <legend>Record adjustment</legend>
              <label>
                Action
                <select
                  value={adjustment}
                  onChange={(event) => {
                    setAdjustment(event.target.value as typeof adjustment)
                    changed()
                  }}
                >
                  <option value="refund">Refund</option>
                  <option value="correction">Correction</option>
                  <option value="void">Void gift</option>
                </select>
              </label>
              {adjustment !== 'void' && (
                <label>
                  Signed amount (refunds are negative)
                  <input
                    inputMode="decimal"
                    value={delta}
                    onChange={(event) => {
                      setDelta(event.target.value)
                      changed()
                    }}
                  />
                </label>
              )}
              <label>
                Reason
                <textarea
                  maxLength={2000}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value)
                    changed()
                  }}
                />
              </label>
              <button
                type="button"
                className="vc-crm-primary"
                disabled={!reason.trim()}
                onClick={() => void applyAdjustment()}
              >
                Record adjustment
              </button>
            </fieldset>
          )}
        </section>
      )}
    </section>
  )
}
