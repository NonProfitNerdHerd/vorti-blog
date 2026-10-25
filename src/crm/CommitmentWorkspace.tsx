'use client'
import { RecordAttachmentLink } from './RecordAttachmentLink'
/* eslint-disable react-hooks/set-state-in-effect -- Resolve data for explicit pinned site/contact contexts. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ContactPicker, crmRead, formatMinor } from './HouseholdWorkspace'
import { ClassificationPicker } from './ClassificationPicker'
import { equalInstallments, givingFrequencies, type GivingFrequency } from './commitment-model'
import { parseMoney } from './money'
import type { GivingCommitment, CommitmentRepository } from './commitments'
import type { GiftSummary } from './finance'
type Detail = Awaited<ReturnType<CommitmentRepository['get']>>
type Draft = {
  name: string
  constituent: string
  amount: string
  currency: string
  exponent: number
  startsOn: string
  endsOn: string
  frequency: GivingFrequency
  campaign: string
}
const empty = (contact = ''): Draft => ({
  name: '',
  constituent: contact,
  amount: '',
  currency: 'USD',
  exponent: 2,
  startsOn: '',
  endsOn: '',
  frequency: 'monthly',
  campaign: '',
})
export function CommitmentWorkspace({
  api,
  site,
  contact,
  focusID,
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  contact?: string
  focusID?: string
  onDirty?: (dirty: boolean) => void
  onSaving?: (saving: boolean) => void
}) {
  const [kind, setKind] = useState<'pledge' | 'recurring'>('pledge'),
    [docs, setDocs] = useState<GivingCommitment[]>([]),
    [next, setNext] = useState<string | null>(null),
    [after, setAfter] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null),
    [creating, setCreating] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => empty(contact)),
    [count, setCount] = useState(1),
    [installments, setInstallments] = useState<
      Array<{ id: string; dueOn: string; amount: string }>
    >([])
  const [through, setThrough] = useState(() => new Intl.DateTimeFormat('en-CA').format(new Date())),
    [offset, setOffset] = useState(0),
    [effective, setEffective] = useState(''),
    [reason, setReason] = useState(''),
    [newName, setNewName] = useState('')
  const [period, setPeriod] = useState(''),
    [payment, setPayment] = useState(''),
    [giftID, setGiftID] = useState(''),
    [gifts, setGifts] = useState<GiftSummary[]>([]),
    [giftPage, setGiftPage] = useState(1),
    [giftTotal, setGiftTotal] = useState(0)
  const generation = useRef(0),
    operation = useRef<{ fingerprint: string; key: string } | null>(null)
  const mark = (value: boolean) => {
    setDirty(value)
    onDirty?.(value)
    operation.current = null
  }
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    mark(true)
  }
  const discard = () => !dirty || window.confirm('Discard unsaved giving changes?')
  const load = useCallback(async () => {
    if (!site || focusID) return
    const version = ++generation.current
    try {
      const result = await crmRead<{
        docs: GivingCommitment[]
        next: string | null
        canEdit: boolean
      }>(
        `${api}/crm/giving?${new URLSearchParams({ site, kind, after, ...(contact ? { contact } : {}) })}`,
      )
      if (version === generation.current) {
        setDocs(result.docs)
        setNext(result.next)
        setCanEdit(result.canEdit)
        setError('')
      }
    } catch (cause) {
      if (version === generation.current) {
        setDocs([])
        setDetail(null)
        setCanEdit(false)
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setCreating(false)
          setDraft(empty())
          setGifts([])
        }
      }
    }
  }, [api, site, kind, after, contact, focusID])
  useEffect(() => {
    void load()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- This counter invalidates pending async responses, not DOM references.
      generation.current++
    }
  }, [load])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, busy])
  const open = async (id: string, cursor = 0, force = false) => {
    if (!force && !discard()) return
    const version = ++generation.current
    try {
      const result = await crmRead<Detail>(
        `${api}/crm/giving?${new URLSearchParams({ site, id, through, offset: String(cursor) })}`,
      )
      if (version !== generation.current) return
      setDetail(result)
      setOffset(cursor)
      setCreating(false)
      setReason('')
      setEffective('')
      setNewName(result.doc.name)
      setGifts([])
      setGiftID('')
      setGiftTotal(0)
      setGiftPage(1)
      setPayment('')
      setPeriod('')
      setError('')
      mark(false)
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setDetail(null)
          setDocs([])
          setCanEdit(false)
        }
      }
    }
  }
  const mutate = async (body: Record<string, unknown>) => {
    if (busy) return
    const version = generation.current,
      intent = {
        ...body,
        site,
        ...(detail ? { id: detail.doc.id, expectedRevision: detail.doc.revision } : {}),
      },
      fingerprint = JSON.stringify(intent)
    if (operation.current?.fingerprint !== fingerprint)
      operation.current = { fingerprint, key: crypto.randomUUID() }
    setBusy(true)
    onSaving?.(true)
    setError('')
    try {
      const result = await crmRead<{ doc: { id: string } }>(`${api}/crm/giving`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...intent, operationKey: operation.current.key }),
      })
      if (version !== generation.current) return
      mark(false)
      setCreating(false)
      await load()
      await open(result.doc.id, offset, true)
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setDetail(null)
          setDocs([])
          setCreating(false)
          setCanEdit(false)
        }
      }
    } finally {
      setBusy(false)
      onSaving?.(false)
    }
  }
  const create = () => {
    try {
      void mutate({
        action: 'create',
        values: {
          ...draft,
          kind,
          minorUnits: parseMoney(draft.amount, { code: draft.currency, exponent: draft.exponent })
            .minorUnits,
          installments: installments.map((i) => ({
            dueOn: i.dueOn,
            minorUnits: parseMoney(i.amount, { code: draft.currency, exponent: draft.exponent })
              .minorUnits,
          })),
        },
      })
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  const loadGifts = async (page = 1) => {
    if (!detail) return
    const version = generation.current
    try {
      const result = await crmRead<{ docs: GiftSummary[]; total: number }>(
        `${api}/crm/finance?${new URLSearchParams({ site, constituent: detail.doc.constituent_id, page: String(page), limit: '25' })}`,
      )
      if (version === generation.current) {
        setGifts(result.docs)
        setGiftPage(page)
        setGiftTotal(result.total)
        setGiftID('')
      }
    } catch (cause) {
      if (version === generation.current) {
        setGifts([])
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setDetail(null)
          setDocs([])
          setCanEdit(false)
        }
      }
    }
  }
  const apply = (reverse?: Detail['applications'][number]) => {
    if (!detail) return
    const gift = gifts.find((g) => g.id === (reverse?.gift_id || giftID))
    if (!gift) {
      setError('Load the gift’s current page before applying or reversing payment.')
      return
    }
    try {
      void mutate({
        action: reverse ? 'reverse-payment' : 'apply-payment',
        gift: gift.id,
        giftRevision: gift.revision,
        installment: reverse?.installment_key || period,
        minorUnits:
          reverse?.amount_minor ||
          parseMoney(payment, { code: detail.doc.currency, exponent: detail.doc.exponent })
            .minorUnits,
        reason,
        application: reverse?.id,
      })
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  return (
    <section className="vc-crm-domain" aria-label="Pledges and recurring giving">
      <h2>Pledges and recurring giving</h2>
      {focusID && (
        <button type="button" disabled={busy} onClick={() => void open(focusID)}>
          Open membership dues
        </button>
      )}
      {focusID && error && <p role="alert">{error}</p>}
      <div hidden={!!focusID}>
        <nav className="vc-crm-toolbar" aria-label="Giving types">
          {(['pledge', 'recurring'] as const).map((k) => (
            <button
              type="button"
              key={k}
              disabled={busy}
              aria-pressed={kind === k}
              onClick={() => {
                if (discard()) {
                  setKind(k)
                  setAfter('')
                  setDetail(null)
                  setCreating(false)
                  mark(false)
                }
              }}
            >
              {k === 'pledge' ? 'Pledges' : 'Recurring schedules'}
            </button>
          ))}
        </nav>
        <p>
          Track commitments and recorded payments here. These schedules never charge a donor or
          create received revenue.
        </p>
        {error && (
          <p role="alert">
            {error}{' '}
            <button type="button" disabled={busy} onClick={() => void load()}>
              Reload list
            </button>
          </p>
        )}
        <div className="vc-crm-toolbar">
          {canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (discard()) {
                  setCreating(true)
                  setDetail(null)
                  setDraft(empty(contact))
                  setInstallments([])
                  setOffset(0)
                  mark(false)
                }
              }}
            >
              Create {kind === 'pledge' ? 'pledge' : 'recurring schedule'}
            </button>
          )}
          <button type="button" disabled={!after || busy} onClick={() => setAfter('')}>
            First page
          </button>
          <button type="button" disabled={!next || busy} onClick={() => setAfter(next || '')}>
            Next page
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Donor</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <button type="button" disabled={busy} onClick={() => void open(d.id)}>
                    {d.name}
                  </button>
                </td>
                <td>{d.label}</td>
                <td>
                  {d.currency} {formatMinor(d.amount_minor, d.exponent)}
                  {d.kind === 'recurring' ? ` / ${d.frequency}` : ''}
                </td>
                <td>{d.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!docs.length && <p>No matching giving records.</p>}
        {creating && (
          <fieldset disabled={busy}>
            <legend>New {kind}</legend>
            <label>
              Name
              <input
                maxLength={180}
                value={draft.name}
                onChange={(e) => change('name', e.target.value)}
              />
            </label>
            {!contact && (
              <ContactPicker
                api={api}
                site={site}
                value={draft.constituent}
                onChange={(id) => change('constituent', id)}
                label="Donor"
              />
            )}
            <label>
              {kind === 'pledge' ? 'Total pledged' : 'Amount per period'}
              <input
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => change('amount', e.target.value)}
              />
            </label>
            <label>
              Currency
              <input
                maxLength={3}
                value={draft.currency}
                onChange={(e) => change('currency', e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Currency decimal places
              <select
                value={draft.exponent}
                onChange={(e) => change('exponent', Number(e.target.value))}
              >
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              Starts on
              <input
                type="date"
                value={draft.startsOn}
                onChange={(e) => change('startsOn', e.target.value)}
              />
            </label>
            <label>
              Ends on (optional)
              <input
                type="date"
                value={draft.endsOn}
                onChange={(e) => change('endsOn', e.target.value)}
              />
            </label>
            <label>
              Frequency
              <select
                value={draft.frequency}
                onChange={(e) => change('frequency', e.target.value as GivingFrequency)}
              >
                {givingFrequencies.map((f) => (
                  <option key={f}>{f}</option>
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
            {kind === 'pledge' && (
              <>
                <label>
                  Installment count
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      setInstallments(
                        equalInstallments(
                          parseMoney(draft.amount, {
                            code: draft.currency,
                            exponent: draft.exponent,
                          }).minorUnits,
                          draft.currency,
                          draft.startsOn,
                          draft.frequency,
                          count,
                        ).map((i) => ({
                          id: crypto.randomUUID(),
                          dueOn: i.dueOn,
                          amount: formatMinor(i.minorUnits, draft.exponent),
                        })),
                      )
                      mark(true)
                    } catch (cause) {
                      setError((cause as Error).message)
                    }
                  }}
                >
                  Generate installments
                </button>
                {installments.map((i, index) => (
                  <div key={i.id} className="vc-crm-toolbar">
                    <label>
                      Installment {index + 1} date
                      <input
                        type="date"
                        value={i.dueOn}
                        onChange={(e) => {
                          setInstallments((rows) =>
                            rows.map((r) => (r.id === i.id ? { ...r, dueOn: e.target.value } : r)),
                          )
                          mark(true)
                        }}
                      />
                    </label>
                    <label>
                      Installment {index + 1} amount
                      <input
                        inputMode="decimal"
                        value={i.amount}
                        onChange={(e) => {
                          setInstallments((rows) =>
                            rows.map((r) => (r.id === i.id ? { ...r, amount: e.target.value } : r)),
                          )
                          mark(true)
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setInstallments((rows) => rows.filter((r) => r.id !== i.id))
                        mark(true)
                      }}
                    >
                      Remove installment
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={installments.length >= 120}
                  onClick={() => {
                    setInstallments((rows) => [
                      ...rows,
                      { id: crypto.randomUUID(), dueOn: draft.startsOn, amount: '' },
                    ])
                    mark(true)
                  }}
                >
                  Add custom installment
                </button>
              </>
            )}
            <button
              type="button"
              disabled={
                !draft.name.trim() ||
                !draft.constituent ||
                !draft.startsOn ||
                !draft.amount ||
                (kind === 'pledge' && !installments.length)
              }
              onClick={create}
            >
              Save giving record
            </button>
            <button
              type="button"
              onClick={() => {
                if (discard()) {
                  setCreating(false)
                  mark(false)
                }
              }}
            >
              Cancel creation
            </button>
          </fieldset>
        )}
      </div>
      {detail && (
        <section aria-label="Giving record details">
          <h3>
            {detail.doc.name} — {detail.doc.label}
          </h3>
          <RecordAttachmentLink site={site} link={{ type: detail.doc.kind, id: detail.doc.id }} />
          <label>
            Reconcile through
            <input
              type="date"
              value={through}
              disabled={busy}
              onChange={(e) => setThrough(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !through}
            onClick={() => void open(detail.doc.id, offset)}
          >
            Refresh reconciliation
          </button>
          <dl>
            {[
              ['Expected', detail.summary.expectedMinor],
              ['Recorded payment credit', detail.summary.receivedMinor],
              ['Outstanding', detail.summary.outstandingMinor],
              ['Due through selected date', detail.summary.overdueMinor],
              ['Cancelled pledge balance', detail.summary.cancelledMinor],
            ].map(([label, minor]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {detail.doc.currency} {formatMinor(minor, detail.doc.exponent)}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Credit reflects refunds and voids. Excess credit on one installment does not pay another
            automatically: reverse and reapply it explicitly.
          </p>
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Expected</th>
                <th>Credited</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.installments.map((i) => (
                <tr key={i.key}>
                  <td>{i.dueOn}</td>
                  <td>{formatMinor(i.minorUnits, detail.doc.exponent)}</td>
                  <td>{formatMinor(i.receivedMinor, detail.doc.exponent)}</td>
                  <td>
                    {i.skipped
                      ? 'Paused'
                      : BigInt(i.receivedMinor) >= BigInt(i.minorUnits)
                        ? 'Received'
                        : i.dueOn <= detail.summary.through
                          ? 'Due'
                          : 'Expected'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            disabled={!offset || busy}
            onClick={() => void open(detail.doc.id, 0)}
          >
            First periods
          </button>
          <button
            type="button"
            disabled={detail.next === null || busy}
            onClick={() => void open(detail.doc.id, detail.next!)}
          >
            Next periods
          </button>
          <h4>Payment history</h4>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Applied</th>
                <th>Current credit</th>
                <th>Reason/status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {detail.applications.map((a) => (
                <tr key={a.id}>
                  <td>{a.created_at.slice(0, 10)}</td>
                  <td>{formatMinor(a.amount_minor, detail.doc.exponent)}</td>
                  <td>{formatMinor(a.effectiveMinor, detail.doc.exponent)}</td>
                  <td>
                    {a.reason}
                    {a.reversed ? ' (reversed)' : ''}
                  </td>
                  <td>
                    {detail.canEdit && !a.reversed && (
                      <button
                        type="button"
                        disabled={busy || !reason.trim()}
                        onClick={() => apply(a)}
                      >
                        Reverse application
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.canEdit && (
            <fieldset disabled={busy}>
              <legend>Changes and recorded payments</legend>
              <label>
                Reason
                <textarea
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value)
                    mark(true)
                  }}
                />
              </label>
              <button type="button" onClick={() => void loadGifts()}>
                Load donor gifts
              </button>
              <label>
                Gift
                <select
                  value={giftID}
                  onChange={(e) => {
                    setGiftID(e.target.value)
                    mark(true)
                  }}
                >
                  <option value="">Choose recorded gift</option>
                  {gifts
                    .filter(
                      (g) =>
                        g.kind !== 'in-kind' &&
                        g.state === 'posted' &&
                        g.currency === detail.doc.currency &&
                        g.exponent === detail.doc.exponent,
                    )
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.receivedOn} — {g.currency} {formatMinor(g.netMinor, g.exponent)} —{' '}
                        {g.reference || g.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="vc-crm-toolbar">
                <button
                  type="button"
                  disabled={giftPage <= 1}
                  onClick={() => void loadGifts(giftPage - 1)}
                >
                  Previous gifts
                </button>
                <button
                  type="button"
                  disabled={giftPage * 25 >= giftTotal}
                  onClick={() => void loadGifts(giftPage + 1)}
                >
                  Next gifts
                </button>
              </div>
              <label>
                Apply to period
                <select
                  value={period}
                  onChange={(e) => {
                    setPeriod(e.target.value)
                    mark(true)
                  }}
                >
                  <option value="">Choose period</option>
                  {detail.installments
                    .filter((i) => !i.skipped)
                    .map((i) => (
                      <option key={i.key} value={i.key}>
                        {i.dueOn}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Payment amount
                <input
                  inputMode="decimal"
                  value={payment}
                  onChange={(e) => {
                    setPayment(e.target.value)
                    mark(true)
                  }}
                />
              </label>
              <button
                type="button"
                disabled={
                  !giftID ||
                  !period ||
                  !payment ||
                  !reason.trim() ||
                  detail.doc.state === 'cancelled'
                }
                onClick={() => apply()}
              >
                Apply recorded payment
              </button>
              <p>
                To reverse, load the gift’s current page and enter a reason. Refunds use unallocated
                cash first, then reduce payment credits proportionally.
              </p>
              {detail.doc.state !== 'cancelled' && (
                <>
                  <label>
                    Effective date
                    <input
                      type="date"
                      value={effective}
                      onChange={(e) => {
                        setEffective(e.target.value)
                        mark(true)
                      }}
                    />
                  </label>
                  <label>
                    Record name
                    <input
                      maxLength={180}
                      value={newName}
                      onChange={(e) => {
                        setNewName(e.target.value)
                        mark(true)
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!reason.trim() || !effective || !newName.trim()}
                    onClick={() =>
                      void mutate({
                        action: 'rename',
                        name: newName,
                        effectiveOn: effective,
                        reason,
                      })
                    }
                  >
                    Save name change
                  </button>
                  {detail.doc.kind === 'recurring' && (
                    <button
                      type="button"
                      disabled={!reason.trim() || !effective}
                      onClick={() =>
                        void mutate({
                          action: detail.doc.state === 'paused' ? 'resume' : 'pause',
                          effectiveOn: effective,
                          reason,
                        })
                      }
                    >
                      {detail.doc.state === 'paused' ? 'Resume schedule' : 'Pause schedule'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!reason.trim() || !effective}
                    onClick={() => {
                      if (window.confirm('Cancel this commitment and retain its history?'))
                        void mutate({ action: 'cancel', effectiveOn: effective, reason })
                    }}
                  >
                    Cancel giving commitment
                  </button>
                  <p>
                    Original terms are retained. To replace amounts or frequency, cancel this record
                    and create a new one.
                  </p>
                </>
              )}
            </fieldset>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (discard()) {
                setDetail(null)
                mark(false)
              }
            }}
          >
            Close giving record
          </button>
        </section>
      )}
    </section>
  )
}
