'use client'
import { RecordActions } from './RecordActions'
/* eslint-disable react-hooks/set-state-in-effect -- Explicit site changes discard the old site's private data before fetching. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Gutter, useConfig } from '@payloadcms/ui'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import type { Household, HouseholdMember } from './households'
import type { ContactSummary } from './contacts'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import './workspace.css'

export async function crmRead<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  const data = (await response.json()) as { message?: string }
  if (!response.ok)
    throw Object.assign(new Error(data.message || 'Unable to load CRM records.'), {
      status: response.status,
    })
  return data as T
}
type ContactPickerProps = {
  api: string
  site: string
  value: string
  onChange: (id: string) => void
  label?: string
}
export function ContactPicker(props: ContactPickerProps) {
  return <ScopedContactPicker key={`${props.api}:${props.site}`} {...props} />
}
function ScopedContactPicker({
  api,
  site,
  value,
  onChange,
  label = 'Contact',
}: ContactPickerProps) {
  const [query, setQuery] = useState(''),
    [docs, setDocs] = useState<ContactSummary[]>([]),
    [error, setError] = useState(''),
    [after, setAfter] = useState<{ label: string; id: string } | null>(null),
    [next, setNext] = useState<{ label: string; id: string } | null>(null),
    [total, setTotal] = useState<number | null>(null),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const focus = () => setRefresh((value) => value + 1)
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setDocs([])
    setNext(null)
    setTotal(null)
    setLoading(true)
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        site,
        search: query,
        limit: '25',
        ...(after ? { afterID: after.id, afterLabel: after.label } : {}),
      })
      void crmRead<{
        docs: ContactSummary[]
        total: number
        next: { label: string; id: string } | null
      }>(`${api}/crm/contacts?${params}`, { signal: controller.signal })
        .then((data) => {
          if (!live) return
          setDocs(data.docs)
          setNext(data.next || null)
          setTotal(data.total ?? data.docs.length)
          setError('')
        })
        .catch((cause) => {
          if (live && !controller.signal.aborted) {
            setDocs([])
            setError(cause.message)
          }
        })
        .finally(() => {
          if (live) setLoading(false)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      live = false
      controller.abort()
    }
  }, [api, site, query, after, refresh])
  return (
    <div>
      <label>
        {label}
        <input
          aria-label={`Search ${label.toLowerCase()}`}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setAfter(null)
            setDocs([])
            setNext(null)
            setTotal(null)
            setLoading(true)
          }}
          placeholder="Search name or email"
        />
        <select
          aria-label={label}
          value={value}
          required
          disabled={loading || !!error}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose contact</option>
          {value && !docs.some((d) => d.id === value) && (
            <option value={value}>Selected contact</option>
          )}
          {docs.map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.label}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <p role="status">Loading {label.toLowerCase()} choices…</p>
      ) : (
        total !== null && <p>{total} matching contacts</p>
      )}
      <div className="vc-crm-toolbar">
        <button type="button" disabled={!after || loading} onClick={() => setAfter(null)}>
          First {label.toLowerCase()} choices
        </button>
        <button type="button" disabled={!next || loading} onClick={() => setAfter(next)}>
          Next {label.toLowerCase()} choices
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
type Detail = { doc: Household; members: HouseholdMember[]; canEdit: boolean }
export function HouseholdWorkspace() {
  const pathname = usePathname()
  const params = useSearchParams()
  const requestedHousehold = params.get('household')
  const requestedSite = params.get('site')
  const openedLocation = useRef('')
  const { config } = useConfig(),
    { binding } = useAdminSite(),
    api = config.routes.api
  const site = binding?.site.id || ''
  const [docs, setDocs] = useState<Household[]>([]),
    [detail, setDetail] = useState<Detail | null>(null)
  const [search, setSearch] = useState(''),
    [after, setAfter] = useState(''),
    [next, setNext] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(''),
    [address, setAddress] = useState(''),
    [primary, setPrimary] = useState(''),
    [archived, setArchived] = useState(false)
  const [member, setMember] = useState(''),
    [endingMember, setEndingMember] = useState(''),
    [role, setRole] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState('')
  const [dirty, setDirty] = useState(false)
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
  const [totals, setTotals] = useState<Array<{
    currency: string
    exponent: number
    minorUnits: string
    count: number
  }> | null>(null)
  const sequence = useRef(0),
    listSequence = useRef(0),
    key = useRef<{ fingerprint: string; key: string } | null>(null)
  const load = useCallback(async () => {
    if (!site) return
    const generation = ++listSequence.current
    try {
      const data = await crmRead<{ docs: Household[]; next: string | null; canEdit: boolean }>(
        `${api}/crm/households?site=${encodeURIComponent(site)}&search=${encodeURIComponent(search)}&after=${encodeURIComponent(after)}`,
      )
      if (generation !== listSequence.current) return
      setDocs(data.docs)
      setNext(data.next)
      setCanEdit(data.canEdit)
      setError('')
    } catch (cause) {
      if (generation === listSequence.current) {
        setDocs([])
        setCanEdit(false)
        setError((cause as Error).message)
      }
    }
  }, [api, site, search, after])
  useEffect(() => {
    setDetail(null)
    setCreating(false)
    setDocs([])
    setTotals(null)
    key.current = null
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate current async requests; this is a monotonic counter, not a DOM ref.
      sequence.current++
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the separate monotonic list request counter.
      listSequence.current++
    }
  }, [site])
  useEffect(() => {
    void load()
  }, [load])
  const open = useCallback(
    async (id: string, saved = false) => {
      if (busy && !saved) return
      if (!saved && dirty && !window.confirm('Discard unsaved household changes?')) return
      const generation = ++sequence.current
      try {
        const data = await crmRead<Detail>(
          `${api}/crm/households?site=${encodeURIComponent(site)}&id=${encodeURIComponent(id)}`,
        )
        if (generation !== sequence.current) return
        setDetail(data)
        setCreating(false)
        setName(data.doc.name)
        setAddress(data.doc.address)
        setPrimary(data.doc.primary_contact || '')
        setArchived(!!data.doc.archived)
        setTotals(null)
        setDirty(false)
        setError('')
        key.current = null
        openedLocation.current = `${site}:${id}`
        const url = new URL(window.location.href)
        url.searchParams.set('site', site)
        url.searchParams.set('household', id)
        window.history.replaceState(window.history.state, '', url)
      } catch (cause) {
        if (generation === sequence.current) {
          setDetail(null)
          setError((cause as Error).message)
        }
      }
    },
    [api, site, dirty, busy],
  )
  useEffect(() => {
    if (!site || requestedSite !== site || !requestedHousehold) return
    const location = `${site}:${requestedHousehold}`
    if (openedLocation.current === location || busy) return
    openedLocation.current = location
    void open(requestedHousehold)
  }, [site, requestedSite, requestedHousehold, busy, open])
  const mutate = async (action: string, values: Record<string, unknown>) => {
    if (busy) return
    const metadataDirty =
      detail &&
      (name !== detail.doc.name ||
        address !== detail.doc.address ||
        primary !== (detail.doc.primary_contact || '') ||
        archived !== !!detail.doc.archived)
    if (
      (action === 'add-member' || action === 'end-member') &&
      metadataDirty &&
      !window.confirm('Discard unsaved household details before changing membership?')
    )
      return
    const generation = sequence.current
    setBusy(true)
    setError('')
    const body = {
      site,
      action,
      values,
      id: action === 'create-household' ? undefined : detail?.doc.id,
      expectedRevision: detail?.doc.revision,
    }
    const fingerprint = JSON.stringify(body)
    if (key.current?.fingerprint !== fingerprint)
      key.current = { fingerprint, key: crypto.randomUUID() }
    try {
      const result = await crmRead<{ doc: { id: string } }>(`${api}/crm/households`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationKey: key.current.key }),
      })
      if (generation !== sequence.current) return
      key.current = null
      setDirty(false)
      setCreating(false)
      if (action === 'add-member') {
        setMember('')
        setRole('')
      }
      if (action === 'end-member') setEndingMember('')
      await load()
      await open(result.doc.id, true)
    } catch (cause) {
      if (generation === sequence.current) {
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setDetail(null)
          setDocs([])
          setCanEdit(false)
        }
      }
    } finally {
      setBusy(false)
    }
  }
  const giving = async () => {
    if (!detail) return
    const generation = sequence.current
    try {
      const data = await crmRead<{ totals: NonNullable<typeof totals> }>(
        `${api}/crm/households?site=${encodeURIComponent(site)}&id=${detail.doc.id}&view=giving`,
      )
      if (generation === sequence.current) setTotals(data.totals)
    } catch (cause) {
      if (generation === sequence.current) {
        setTotals(null)
        setError((cause as Error).message)
      }
    }
  }
  return (
    <Gutter className="vc-crm vc-crm-domain">
      <h2>Households</h2>
      {error && <p role="alert">{error}</p>}
      <div className="vc-crm-toolbar">
        <label>
          Search households
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setAfter('')
            }}
          />
        </label>
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (dirty && !window.confirm('Discard unsaved household changes?')) return
              sequence.current++
              const url = new URL(window.location.href)
              url.searchParams.delete('household')
              window.history.replaceState(window.history.state, '', url)
              openedLocation.current = ''
              setCreating(true)
              setDetail(null)
              setName('')
              setAddress('')
              setPrimary('')
              setArchived(false)
              setDirty(false)
            }}
          >
            Create household
          </button>
        )}
        <button type="button" disabled={!after} onClick={() => setAfter('')}>
          First page
        </button>
        <button type="button" disabled={!next} onClick={() => setAfter(next || '')}>
          Next page
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.id}>
              <td>
                <button type="button" disabled={busy} onClick={() => void open(doc.id)}>
                  {doc.name}
                </button>
              </td>
              <td>{doc.archived ? 'Archived' : 'Active'}</td>
              <td>{doc.address}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!docs.length && <p>No matching households.</p>}
      {(creating || detail) && (
        <section aria-label="Household editor" onChange={() => setDirty(true)}>
          <h3>{creating ? 'New household' : detail?.doc.name}</h3>
          {detail && (
            <RecordActions site={site} link={{ type: 'household', id: detail.doc.id }} />
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void mutate(creating ? 'create-household' : 'update-household', {
                name,
                address,
                primaryContact: primary,
                archived,
              })
            }}
          >
            <fieldset disabled={busy || !(creating ? canEdit : detail?.canEdit)}>
              <label>
                Name
                <input
                  required
                  maxLength={180}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Mailing address
                <textarea
                  maxLength={2000}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </label>
              {detail && (
                <>
                  <label>
                    Primary contact
                    <select value={primary} onChange={(e) => setPrimary(e.target.value)}>
                      <option value="">None</option>
                      {detail.members
                        .filter((m) => !m.ended_on)
                        .map((m) => (
                          <option key={m.id} value={m.constituent_id}>
                            {m.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={archived}
                      onChange={(e) => setArchived(e.target.checked)}
                    />
                    Archived
                  </label>
                </>
              )}
              <button type="submit">Save household</button>
            </fieldset>
          </form>
          {detail && (
            <>
              <h3>Member history</h3>
              <table>
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Role</th>
                    <th>From</th>
                    <th>Through</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link
                          href={`${pathname}?${new URLSearchParams({ view: 'contacts', site, contact: m.constituent_id })}`}
                          onClick={(event) => {
                            if (
                              busy ||
                              (dirty && !window.confirm('Discard unsaved household changes?'))
                            )
                              event.preventDefault()
                          }}
                        >
                          {m.label}
                        </Link>
                      </td>
                      <td>{m.role}</td>
                      <td>{m.started_on}</td>
                      <td>{m.ended_on || 'Current'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.canEdit && !detail.doc.archived && (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void mutate('add-member', { constituent: member, role, startedOn: start })
                    }}
                  >
                    <fieldset disabled={busy}>
                      <legend>Add member</legend>
                      <ContactPicker api={api} site={site} value={member} onChange={setMember} />
                      <label>
                        Role
                        <input
                          maxLength={120}
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                        />
                      </label>
                      <label>
                        Member since
                        <input
                          required
                          type="date"
                          value={start}
                          onChange={(e) => setStart(e.target.value)}
                        />
                      </label>
                      <button type="submit">Add member</button>
                    </fieldset>
                  </form>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void mutate('end-member', { member: endingMember, endedOn: end })
                    }}
                  >
                    <fieldset disabled={busy}>
                      <legend>End membership</legend>
                      <label>
                        Member
                        <select
                          required
                          value={endingMember}
                          onChange={(e) => setEndingMember(e.target.value)}
                        >
                          <option value="">Choose current member</option>
                          {detail.members
                            .filter((m) => !m.ended_on)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Last membership date
                        <input
                          required
                          type="date"
                          value={end}
                          onChange={(e) => setEnd(e.target.value)}
                        />
                      </label>
                      <button type="submit">End membership</button>
                    </fieldset>
                  </form>
                </>
              )}
              <button type="button" onClick={() => void giving()}>
                Load authorized giving summary
              </button>
              {totals && (
                <>
                  <p>
                    Cash gifts received during membership, net of adjustments. In-kind gifts are
                    excluded.
                  </p>
                  {totals.length ? (
                    <ul>
                      {totals.map((t) => (
                        <li key={t.currency}>
                          {t.currency} {formatMinor(t.minorUnits, t.exponent)} ({t.count} gifts)
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No qualifying gifts.</p>
                  )}
                </>
              )}
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm('Discard unsaved household changes?')) {
                sequence.current++
                setCreating(false)
                setDetail(null)
                setDirty(false)
                const url = new URL(window.location.href)
                url.searchParams.delete('household')
                window.history.replaceState(window.history.state, '', url)
                openedLocation.current = ''
              }
            }}
          >
            Close household
          </button>
        </section>
      )}
    </Gutter>
  )
}
export function formatMinor(value: string, exponent: number): string {
  const negative = value.startsWith('-'),
    digits = (negative ? value.slice(1) : value).padStart(exponent + 1, '0')
  return `${negative ? '-' : ''}${exponent ? digits.slice(0, -exponent) + '.' + digits.slice(-exponent) : digits}`
}
