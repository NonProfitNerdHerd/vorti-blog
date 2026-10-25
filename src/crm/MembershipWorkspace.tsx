'use client'
import { RecordActions } from './RecordActions'
/* eslint-disable react-hooks/set-state-in-effect -- Fetch explicitly scoped membership lists. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ContactPicker, crmRead, formatMinor } from './HouseholdWorkspace'
import { CommitmentWorkspace } from './CommitmentWorkspace'
import { membershipEnd, membershipStatus, type MembershipType } from './membership-model'
import type { MembershipRepository } from './memberships'
import type { Household, HouseholdMember } from './households'
import { parseMoney } from './money'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
type Detail = Awaited<ReturnType<MembershipRepository['get']>>
type Row = Awaited<ReturnType<MembershipRepository['list']>>['docs'][number]
const emptyType = () => ({
  name: '',
  eligibility: 'person' as 'person' | 'household',
  termMonths: 12,
  amount: '0.00',
  currency: 'USD',
  exponent: 2,
  archived: false,
})
export function MembershipWorkspace({
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
  const pathname = usePathname()
  const [types, setTypes] = useState<MembershipType[]>([]),
    [docs, setDocs] = useState<Row[]>([]),
    [canEdit, setCanEdit] = useState(false),
    [canConfigure, setCanConfigure] = useState(false),
    [next, setNext] = useState<string | null>(null),
    [after, setAfter] = useState(''),
    [status, setStatus] = useState('all'),
    [asOf, setAsOf] = useState(() => new Intl.DateTimeFormat('en-CA').format(new Date()))
  const [detail, setDetail] = useState<Detail | null>(null),
    [creating, setCreating] = useState(false),
    [typeEditor, setTypeEditor] = useState<MembershipType | 'new' | null>(null),
    [typeDraft, setTypeDraft] = useState(emptyType)
  const [typeID, setTypeID] = useState(''),
    [person, setPerson] = useState(contact || ''),
    [household, setHousehold] = useState(''),
    [households, setHouseholds] = useState<Household[]>([]),
    [householdNext, setHouseholdNext] = useState<string | null>(null),
    [preview, setPreview] = useState<{ doc: Household; members: HouseholdMember[] } | null>(null),
    [billing, setBilling] = useState('')
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [renewal, setRenewal] = useState<Detail['doc'] | null>(null),
    [cancelOn, setCancelOn] = useState(''),
    [reason, setReason] = useState(''),
    [showDues, setShowDues] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false)
  const generation = useRef(0),
    operation = useRef<{ fingerprint: string; key: string } | null>(null)
  const mark = (value: boolean) => {
    setDirty(value)
    onDirty?.(value)
    operation.current = null
  }
  const discard = () => !dirty || window.confirm('Discard unsaved membership changes?')
  const load = useCallback(async () => {
    if (!site || !asOf) return
    const version = ++generation.current
    try {
      const list = await crmRead<{ docs: Row[]; next: string | null; canEdit: boolean }>(
        `${api}/crm/memberships?${new URLSearchParams({ site, asOf, status, after, ...(contact ? { contact } : {}) })}`,
      )
      const all: MembershipType[] = []
      let cursor: string | null = ''
      let configure = false
      do {
        const page: { docs: MembershipType[]; next: string | null; canConfigure: boolean } =
          await crmRead(
            `${api}/crm/memberships?${new URLSearchParams({ site, view: 'types', after: cursor || '' })}`,
          )
        all.push(...page.docs)
        cursor = page.next
        configure = page.canConfigure
      } while (cursor && version === generation.current)
      if (version === generation.current) {
        setDocs(list.docs)
        setNext(list.next)
        setCanEdit(list.canEdit)
        setTypes(all)
        setCanConfigure(configure)
        setError('')
      }
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message)
        setDocs([])
        setTypes([])
        setCanEdit(false)
        setCanConfigure(false)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setDetail(null)
          setCreating(false)
          setTypeEditor(null)
        }
      }
    }
  }, [api, site, asOf, status, after, contact])
  useEffect(() => {
    void load()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Monotonic request counter, not a DOM reference.
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
  const open = async (id: string, force = false) => {
    if (!force && !discard()) return
    const version = ++generation.current
    try {
      const data = await crmRead<Detail>(
        `${api}/crm/memberships?${new URLSearchParams({ site, id, asOf })}`,
      )
      if (version === generation.current) {
        setDetail(data)
        setCreating(false)
        setTypeEditor(null)
        setShowDues(false)
        setCancelOn('')
        setReason('')
        setError('')
        mark(false)
      }
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message)
        setDetail(null)
      }
    }
  }
  const mutate = async (body: Record<string, unknown>) => {
    if (busy) return
    const version = generation.current,
      intent = { ...body, site },
      fingerprint = JSON.stringify(intent)
    if (operation.current?.fingerprint !== fingerprint)
      operation.current = { fingerprint, key: crypto.randomUUID() }
    setBusy(true)
    onSaving?.(true)
    setError('')
    try {
      const result = await crmRead<{ doc: { id: string } }>(`${api}/crm/memberships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...intent, operationKey: operation.current.key }),
      })
      if (version !== generation.current) return
      mark(false)
      setCreating(false)
      setTypeEditor(null)
      await load()
      if (body.action !== 'save-type') await open(result.doc.id, true)
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setDetail(null)
          setCreating(false)
          setTypeEditor(null)
          setDocs([])
        }
      }
    } finally {
      setBusy(false)
      onSaving?.(false)
    }
  }
  const loadHouseholds = async (cursor = '') => {
    const version = generation.current
    try {
      const data = await crmRead<{ docs: Household[]; next: string | null }>(
        `${api}/crm/households?${new URLSearchParams({ site, after: cursor })}`,
      )
      if (version === generation.current) {
        setHouseholds((old) => (cursor ? [...old, ...data.docs] : data.docs))
        setHouseholdNext(data.next)
      }
    } catch (cause) {
      if (version === generation.current) setError((cause as Error).message)
    }
  }
  const previewHousehold = async () => {
    const version = generation.current
    try {
      const data = await crmRead<{ doc: Household; members: HouseholdMember[] }>(
        `${api}/crm/households?${new URLSearchParams({ site, id: household })}`,
      )
      if (version === generation.current) {
        const members = data.members.filter(
          (m) => m.started_on <= start && (!m.ended_on || m.ended_on >= start),
        )
        setPreview({ ...data, members })
        setBilling(
          members.some((m) => m.constituent_id === data.doc.primary_contact)
            ? data.doc.primary_contact!
            : members[0]?.constituent_id || '',
        )
        mark(true)
      }
    } catch (cause) {
      if (version === generation.current) {
        setPreview(null)
        setError((cause as Error).message)
      }
    }
  }
  const begin = (previous?: Detail['doc']) => {
    if (!discard()) return
    setCreating(true)
    setDetail(null)
    setTypeEditor(null)
    setRenewal(previous || null)
    setTypeID(previous?.type_id || '')
    setPerson(previous?.person_id || contact || '')
    setHousehold(previous?.household_id || '')
    setBilling(previous?.billing_contact_id || '')
    setPreview(null)
    setEnd('')
    if (previous) {
      const date = new Date(previous.ends_on + 'T00:00:00Z')
      date.setUTCDate(date.getUTCDate() + 1)
      setStart(date.toISOString().slice(0, 10))
    } else setStart('')
    mark(false)
    void loadHouseholds()
  }
  const selected = types.find((t) => t.id === typeID)
  const enroll = () => {
    if (!selected) return
    void mutate({
      action: 'enroll',
      values: {
        type: typeID,
        typeRevision: selected.revision,
        person,
        household,
        householdRevision: preview?.doc.revision,
        billingContact: billing,
        startsOn: start,
        endsOn: end,
        renewedFrom: renewal?.id,
        previousRevision: renewal?.revision,
      },
    })
  }
  const saveType = () => {
    try {
      void mutate({
        action: 'save-type',
        id: typeEditor && typeEditor !== 'new' ? typeEditor.id : undefined,
        expectedRevision: typeEditor && typeEditor !== 'new' ? typeEditor.revision : undefined,
        values: {
          ...typeDraft,
          minorUnits: parseMoney(typeDraft.amount, {
            code: typeDraft.currency,
            exponent: typeDraft.exponent,
          }).minorUnits,
        },
      })
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  return (
    <section className="vc-crm-domain" aria-label="Memberships">
      <h2>Memberships</h2>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" disabled={busy} onClick={() => void load()}>
            Reload memberships
          </button>
        </p>
      )}
      <div className="vc-crm-toolbar">
        <label>
          As of
          <input
            type="date"
            value={asOf}
            disabled={busy}
            onChange={(e) => {
              setAsOf(e.target.value)
              setAfter('')
            }}
          />
        </label>
        <label>
          Membership status
          <select
            value={status}
            disabled={busy}
            onChange={(e) => {
              setStatus(e.target.value)
              setAfter('')
            }}
          >
            {['all', 'current', 'expiring', 'expired', 'cancelled', 'upcoming'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {canEdit && (
          <button type="button" disabled={busy} onClick={() => begin()}>
            Enroll membership
          </button>
        )}
        <button type="button" disabled={!after || busy} onClick={() => setAfter('')}>
          First page
        </button>
        <button type="button" disabled={!next || busy} onClick={() => setAfter(next || '')}>
          Next page
        </button>
      </div>
      <p>
        Expiring shows current terms ending within 30 days. Membership status follows term dates;
        expected dues do not mark payments as received.
      </p>
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Type</th>
            <th>Term</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>
                <button type="button" disabled={busy} onClick={() => void open(d.id)}>
                  {d.label}
                </button>
              </td>
              <td>{d.type_name}</td>
              <td>
                {d.starts_on} – {d.ends_on}
              </td>
              <td>{d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!docs.length && <p>No matching membership terms.</p>}
      <details>
        <summary>Membership types</summary>
        <ul>
          {types.map((t) => (
            <li key={t.id}>
              {t.name} — {t.eligibility}, {t.term_months} months, {t.currency}{' '}
              {formatMinor(t.dues_minor, t.exponent)} {t.archived ? '(archived)' : ''}{' '}
              {canConfigure && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (discard()) {
                      setTypeEditor(t)
                      setCreating(false)
                      setDetail(null)
                      setTypeDraft({
                        name: t.name,
                        eligibility: t.eligibility,
                        termMonths: t.term_months,
                        amount: formatMinor(t.dues_minor, t.exponent),
                        currency: t.currency,
                        exponent: t.exponent,
                        archived: !!t.archived,
                      })
                      mark(false)
                    }
                  }}
                >
                  Edit type
                </button>
              )}
            </li>
          ))}
        </ul>
        {canConfigure && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (discard()) {
                setTypeEditor('new')
                setTypeDraft(emptyType())
                setCreating(false)
                setDetail(null)
                mark(false)
              }
            }}
          >
            Create membership type
          </button>
        )}
      </details>
      {typeEditor && (
        <fieldset disabled={busy}>
          <legend>Membership type</legend>
          <label>
            Type name
            <input
              value={typeDraft.name}
              maxLength={120}
              onChange={(e) => {
                setTypeDraft((d) => ({ ...d, name: e.target.value }))
                mark(true)
              }}
            />
          </label>
          <label>
            Eligibility
            <select
              value={typeDraft.eligibility}
              onChange={(e) => {
                setTypeDraft((d) => ({
                  ...d,
                  eligibility: e.target.value as 'person' | 'household',
                }))
                mark(true)
              }}
            >
              <option value="person">Individual</option>
              <option value="household">Household</option>
            </select>
          </label>
          <label>
            Term length in months
            <input
              type="number"
              min={1}
              max={120}
              value={typeDraft.termMonths}
              onChange={(e) => {
                setTypeDraft((d) => ({ ...d, termMonths: Number(e.target.value) }))
                mark(true)
              }}
            />
          </label>
          <label>
            Dues amount
            <input
              inputMode="decimal"
              value={typeDraft.amount}
              onChange={(e) => {
                setTypeDraft((d) => ({ ...d, amount: e.target.value }))
                mark(true)
              }}
            />
          </label>
          <label>
            Dues currency
            <input
              maxLength={3}
              value={typeDraft.currency}
              onChange={(e) => {
                setTypeDraft((d) => ({ ...d, currency: e.target.value.toUpperCase() }))
                mark(true)
              }}
            />
          </label>
          <label>
            Dues decimal places
            <select
              value={typeDraft.exponent}
              onChange={(e) => {
                setTypeDraft((d) => ({ ...d, exponent: Number(e.target.value) }))
                mark(true)
              }}
            >
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={typeDraft.archived}
              onChange={(e) => {
                setTypeDraft((d) => ({ ...d, archived: e.target.checked }))
                mark(true)
              }}
            />
            Archived
          </label>
          <button type="button" disabled={!typeDraft.name.trim()} onClick={saveType}>
            Save membership type
          </button>
          <button
            type="button"
            onClick={() => {
              if (discard()) {
                setTypeEditor(null)
                mark(false)
              }
            }}
          >
            Close type editor
          </button>
          <p>
            Changes apply to new terms; existing membership terms retain their recorded dues and
            coverage.
          </p>
        </fieldset>
      )}
      {creating && (
        <fieldset disabled={busy}>
          <legend>{renewal ? 'Renew membership' : 'Enroll membership'}</legend>
          <label>
            Membership type
            <select
              value={typeID}
              disabled={!!renewal}
              onChange={(e) => {
                setTypeID(e.target.value)
                setPreview(null)
                mark(true)
              }}
            >
              <option value="">Choose type</option>
              {types
                .filter((t) => !t.archived)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Term starts on
            <input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                setPreview(null)
                mark(true)
              }}
            />
          </label>
          <label>
            Term ends on (optional)
            <input
              type="date"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value)
                mark(true)
              }}
            />
          </label>
          {selected && (
            <>
              <button
                type="button"
                disabled={!start}
                onClick={() => {
                  try {
                    setEnd(membershipEnd(start, selected.term_months))
                    mark(true)
                  } catch (cause) {
                    setError((cause as Error).message)
                  }
                }}
              >
                Use type term length
              </button>
              <p>
                Dues: {selected.currency} {formatMinor(selected.dues_minor, selected.exponent)}.
                Paid terms require finance edit permission to create their dues expectation.
              </p>
              {selected.eligibility === 'person' ? (
                <ContactPicker
                  api={api}
                  site={site}
                  value={person}
                  label="Member"
                  onChange={(id) => {
                    setPerson(id)
                    mark(true)
                  }}
                />
              ) : (
                <>
                  <label>
                    Household
                    <select
                      value={household}
                      onChange={(e) => {
                        setHousehold(e.target.value)
                        setPreview(null)
                        mark(true)
                      }}
                    >
                      <option value="">Choose household</option>
                      {households
                        .filter((h) => !h.archived)
                        .map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {householdNext && (
                    <button type="button" onClick={() => void loadHouseholds(householdNext)}>
                      Load more households
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!household || !start}
                    onClick={() => void previewHousehold()}
                  >
                    Preview covered members
                  </button>
                  {preview && (
                    <>
                      <ul>
                        {preview.members.map((m) => (
                          <li key={m.id}>{m.label}</li>
                        ))}
                      </ul>
                      <label>
                        Billing contact
                        <select
                          value={billing}
                          onChange={(e) => {
                            setBilling(e.target.value)
                            mark(true)
                          }}
                        >
                          <option value="">Choose covered member</option>
                          {preview.members.map((m) => (
                            <option key={m.id} value={m.constituent_id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </>
              )}
              <button
                type="button"
                disabled={
                  !start || (selected.eligibility === 'person' ? !person : !preview || !billing)
                }
                onClick={enroll}
              >
                Save membership term
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              if (discard()) {
                setCreating(false)
                mark(false)
              }
            }}
          >
            Cancel enrollment
          </button>
        </fieldset>
      )}
      {detail && (
        <section aria-label="Membership term details">
          <h3>
            {detail.doc.label} — {detail.doc.type_name}
          </h3>
          <RecordActions site={site} link={{ type: 'membership', id: detail.doc.id }} />
          <Link
            href={`${pathname}?${new URLSearchParams({ view: 'contacts', site, contact: detail.doc.billing_contact_id, contactTab: 'correspondence', renewalMembership: detail.doc.id })}`}
            onClick={(event) => {
              if (busy || !discard()) event.preventDefault()
            }}
          >
            Prepare membership renewal letter
          </Link>
          <p>
            {detail.doc.starts_on} through {detail.doc.ends_on};{' '}
            {membershipStatus(detail.doc, asOf)}. Dues {detail.doc.currency}{' '}
            {formatMinor(detail.doc.dues_minor, detail.doc.exponent)}.
          </p>
          <h4>Covered-member history</h4>
          <ul>
            {detail.covered.map((c) => (
              <li key={c.id}>{c.label}</li>
            ))}
          </ul>
          {detail.doc.renewed_from && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void open(detail.doc.renewed_from!)}
            >
              Open previous term
            </button>
          )}
          {detail.canEdit && (
            <>
              <button type="button" disabled={busy} onClick={() => begin(detail.doc)}>
                Renew membership
              </button>
              {!detail.doc.cancelled_on && (
                <fieldset disabled={busy}>
                  <legend>Cancel term</legend>
                  <label>
                    Cancellation date
                    <input
                      type="date"
                      value={cancelOn}
                      onChange={(e) => {
                        setCancelOn(e.target.value)
                        mark(true)
                      }}
                    />
                  </label>
                  <label>
                    Cancellation reason
                    <textarea
                      maxLength={2000}
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value)
                        mark(true)
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!cancelOn || !reason.trim()}
                    onClick={() => {
                      if (window.confirm('Cancel membership and retain term history?'))
                        void mutate({
                          action: 'cancel',
                          id: detail.doc.id,
                          expectedRevision: detail.doc.revision,
                          effectiveOn: cancelOn,
                          reason,
                        })
                    }}
                  >
                    Cancel membership term
                  </button>
                  <p>
                    Cancelling membership does not write off outstanding dues. A finance editor can
                    review or cancel the linked dues expectation separately.
                  </p>
                </fieldset>
              )}
            </>
          )}
          {detail.doc.dues_commitment_id && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (discard()) {
                    setShowDues((v) => !v)
                    mark(false)
                  }
                }}
              >
                Manage recorded dues payments
              </button>
              {showDues && (
                <CommitmentWorkspace
                  key={detail.doc.dues_commitment_id}
                  api={api}
                  site={site}
                  contact={detail.doc.billing_contact_id}
                  focusID={detail.doc.dues_commitment_id}
                  onDirty={mark}
                  onSaving={(value) => {
                    setBusy(value)
                    onSaving?.(value)
                  }}
                />
              )}
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (discard()) {
                setDetail(null)
                setShowDues(false)
                mark(false)
              }
            }}
          >
            Close membership term
          </button>
        </section>
      )}
    </section>
  )
}
