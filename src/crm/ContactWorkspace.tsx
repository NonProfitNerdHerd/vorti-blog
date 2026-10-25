'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Gutter, useConfig } from '@payloadcms/ui'
import { constituentRoles, type ContactProfile } from './contact-model'
import type { ContactSummary } from './contacts'
import { ContactCorrections } from './ContactCorrections'
import { ContactGifts } from './ContactGifts'
import { ContactRelationships } from './ContactRelationships'
import { ContactActivities } from './ContactActivities'
import { CommitmentWorkspace } from './CommitmentWorkspace'
import { MembershipWorkspace } from './MembershipWorkspace'
import { OpportunityWorkspace } from './OpportunityWorkspace'
import { VolunteerWorkspace } from './VolunteerWorkspace'
import { CorrespondenceWorkspace } from './CorrespondenceWorkspace'
import { AttachmentWorkspace } from './AttachmentWorkspace'
import { ContactTimeline } from './ContactTimeline'
import Link from 'next/link'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import './workspace.css'

type Detail = ContactSummary & {
  profile: ContactProfile
  canEditProfile: boolean
  canEditChapter: boolean
}
type Cursor = { label: string; id: string }
type Context = { site: { id: string; name: string }; canCreate: boolean }
type ContactPage = { docs: ContactSummary[]; total: number; next: Cursor | null }
const empty = (): ContactProfile => ({
  kind: 'person',
  firstName: '',
  lastName: '',
  preferredName: '',
  organizationName: '',
  methods: [],
  addresses: [],
  communication: {
    emailAllowed: true,
    phoneAllowed: true,
    mailAllowed: true,
    volunteerAllowed: true,
  },
})
export function ContactWorkspace() {
  const {
    config: {
      routes: { api, admin },
    },
  } = useConfig()
  const [site, setSite] = useState<{ id: string; name: string } | null>(null),
    [canCreate, setCanCreate] = useState(false)
  const [docs, setDocs] = useState<ContactSummary[]>([]),
    [total, setTotal] = useState(0),
    [search, setSearch] = useState(''),
    [role, setRole] = useState('')
  const [cursor, setCursor] = useState<Cursor | null>(null),
    [next, setNext] = useState<Cursor | null>(null),
    [pages, setPages] = useState<Array<Cursor | null>>([])
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [notice, setNotice] = useState('')
  const [editor, setEditor] = useState<Detail | 'new' | null>(null),
    [profile, setProfile] = useState<ContactProfile>(empty),
    [roles, setRoles] = useState<string[]>(['contact'])
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [correction, setCorrection] = useState('')
  const dialog = useRef<HTMLDialogElement>(null),
    operation = useRef<string | null>(null),
    requestSequence = useRef(0)
  const accessGeneration = useRef(0)
  const pinnedSite = useRef<string | null>(null)
  const { binding } = useAdminSite()
  const loseAccess = useCallback((): void => {
    accessGeneration.current++
    requestSequence.current++
    dialog.current?.close()
    setEditor(null)
    setProfile(empty())
    setSite(null)
    setDocs([])
    setTotal(0)
    setCanCreate(false)
    setDirty(false)
    setLoading(false)
    setSaving(false)
    operation.current = null
    setError('Your CRM access changed. Reload the workspace to check your current permissions.')
  }, [])
  const [tab, setTab] = useState<'profile' | 'chapter' | 'corrections' | 'gifts' | 'relationships' | 'communications' | 'giving' | 'memberships' | 'opportunities' | 'volunteers' | 'correspondence' | 'attachments' | 'timeline'>('profile'),
    [tagInput, setTagInput] = useState('')
  const read = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { ...init, cache: 'no-store' }),
      data = (await response.json()) as T & { message?: string }
    if (!response.ok)
      throw Object.assign(new Error(data.message || 'Unable to load CRM. Try again.'), {
        status: response.status,
      })
    return data
  }, [])
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current
    setLoading(true)
    setError('')
    try {
      const selected = pinnedSite.current || new URL(window.location.href).searchParams.get('site')
      const context = await read<Context>(api + '/crm/context' + (selected ? '?site=' + encodeURIComponent(selected) : ''))
      if (sequence !== requestSequence.current) return
      pinnedSite.current = context.site.id
      const query = new URLSearchParams({ site: context.site.id, search, role, limit: '50' })
      if (cursor) {
        query.set('afterID', cursor.id)
        query.set('afterLabel', cursor.label)
      }
      const result = await read<ContactPage>(api + '/crm/contacts?' + query)
      if (sequence !== requestSequence.current) return
      setSite(context.site)
      setCanCreate(context.canCreate)
      setDocs(result.docs)
      setTotal(result.total)
      setNext(result.next)
    } catch (cause) {
      if (sequence === requestSequence.current) {
        if (
          cause &&
          typeof cause === 'object' &&
          'status' in cause &&
          [401, 403].includes(Number(cause.status))
        )
          loseAccess()
        setDocs([])
        setTotal(0)
        setCanCreate(false)
        setError(cause instanceof Error ? cause.message : 'Unable to load contacts.')
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [api, cursor, read, role, search, loseAccess])
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 200)
    return () => clearTimeout(timer)
  }, [refresh])
  useEffect(() => {
    const focus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [refresh])
  useEffect((): void => {
    if (editor && !dialog.current?.open) dialog.current?.showModal()
  }, [editor])
  useEffect((): (() => void) | undefined => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    const before = (event: BeforeUnloadEvent): void => {
      if (dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', before)
    return () => window.removeEventListener('beforeunload', before)
  }, [dirty])
  useEffect(() => {
    const navigate = (event: MouseEvent): void => {
      if (!dirty || !(event.target instanceof Element) || !event.target.closest('a[href]')) return
      if (!window.confirm('Discard the unsaved contact changes?')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click', navigate, true)
    return () => document.removeEventListener('click', navigate, true)
  }, [dirty])
  const change = (patch: Partial<ContactProfile>) => {
    setProfile((value) => ({ ...value, ...patch }))
    setDirty(true)
    operation.current = null
  }
  const close = () => {
    if (saving || (dirty && !window.confirm('Discard the unsaved contact changes?'))) return
    dialog.current?.close()
    setEditor(null)
    setDirty(false)
    operation.current = null
  }
  const open = async (id?: string) => {
    if (!site) return
    setSaveError('')
    setTab('profile')
    setTagInput('')
    setConfirmed(false)
    setCorrection('')
    setDirty(false)
    operation.current = null
    if (!id) {
      setProfile(empty())
      setRoles(['contact'])
      setEditor('new')
      return
    }
    try {
      const generation = accessGeneration.current
      const data = await read<{ doc: Detail }>(
        api + '/crm/contacts?' + new URLSearchParams({ site: site.id, id }),
      )
      if (generation !== accessGeneration.current) return
      setProfile(data.doc.profile)
      setRoles(data.doc.roles)
      setTagInput(data.doc.tags.join(', '))
      setEditor(data.doc)
    } catch (cause) {
      if (
        cause &&
        typeof cause === 'object' &&
        'status' in cause &&
        [401, 403].includes(Number(cause.status))
      ) {
        loseAccess()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Unable to open contact.')
    }
  }
  const editable =
    editor === 'new' || !!(tab === 'chapter' ? editor?.canEditChapter : editor?.canEditProfile)
  const switchTab = (nextTab: 'profile' | 'chapter' | 'corrections' | 'gifts' | 'relationships' | 'communications' | 'giving' | 'memberships' | 'opportunities' | 'volunteers' | 'correspondence' | 'attachments' | 'timeline') => {
    if (
      saving ||
      !editor ||
      editor === 'new' ||
      tab === nextTab ||
      (dirty && !window.confirm('Discard unsaved changes before changing tabs?'))
    )
      return
    setProfile(editor.profile)
    setRoles(editor.roles)
    setTagInput(editor.tags.join(', '))
    setDirty(false)
    setSaveError('')
    setTab(nextTab)
    operation.current = null
  }
  const save = async () => {
    if (!site || !editor || saving || tab === 'corrections' || tab === 'gifts' || tab === 'relationships' || tab === 'communications' || tab === 'giving' || tab === 'memberships' || tab === 'opportunities' || tab === 'volunteers' || tab === 'correspondence' || tab === 'attachments' || tab === 'timeline') return
    setSaving(true)
    setSaveError('')
    operation.current ||= crypto.randomUUID()
    const creating = editor === 'new'
    try {
      await read(api + '/crm/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site: site.id,
          operationKey: operation.current,
          action: creating
            ? 'create'
            : tab === 'chapter'
              ? 'update-chapter'
              : editable
                ? 'update-profile'
                : 'request-correction',
          id: creating ? undefined : editor.id,
          expectedRevision: creating
            ? undefined
            : tab === 'chapter'
              ? editor.affiliationRevision
              : editor.revision,
          profile,
          roles,
          tags: tagInput
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          confirmedSharedUpdate: confirmed,
          message: correction,
        }),
      })
      setDirty(false)
      dialog.current?.close()
      setEditor(null)
      operation.current = null
      setNotice(
        editable
          ? creating
            ? 'Contact created.'
            : tab === 'chapter'
              ? 'Chapter details updated.'
              : 'Shared contact profile updated.'
          : 'Correction request submitted.',
      )
      await refresh()
    } catch (cause) {
      if (
        cause &&
        typeof cause === 'object' &&
        'status' in cause &&
        [401, 403].includes(Number(cause.status))
      ) {
        loseAccess()
        return
      }
      setSaveError(
        cause instanceof Error ? cause.message : 'Unable to save. Your input has been retained.',
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <Gutter className="vc-crm">
      <header className="vc-crm-heading">
        <div>
          <h1>CRM</h1>
          <p>{site?.name || 'Constituent workspace'}</p>
          {binding && <Link href={`${admin}/globals/site-settings?tab=SubSites&site=${encodeURIComponent(binding.site.id)}`}>Sites and permissions</Link>}
        </div>
        <div>
          <button type="button" disabled={loading} onClick={() => void refresh()}>
            Refresh
          </button>
          {canCreate && (
            <button className="vc-crm-primary" type="button" disabled={saving} onClick={() => void open()}>
              New contact
            </button>
          )}
        </div>
      </header>
      {notice && (
        <div role="status" className="vc-crm-success">
          {notice}
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      <h2>
        Contacts <small>{total}</small>
      </h2>
      <div className="vc-crm-toolbar">
        <label>
          Search
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setCursor(null)
              setPages([])
            }}
          />
        </label>
        <label>
          Role
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value)
              setCursor(null)
              setPages([])
            }}
          >
            <option value="">All roles</option>
            {constituentRoles.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className="vc-crm-pagination">
          <button
            type="button"
            disabled={!pages.length || loading}
            onClick={() => {
              setCursor(pages.at(-1) || null)
              setPages((value) => value.slice(0, -1))
            }}
          >
            Previous
          </button>
          <span>Page {pages.length + 1}</span>
          <button
            type="button"
            disabled={!next || loading}
            onClick={() => {
              setPages((value) => [...value, cursor])
              setCursor(next)
            }}
          >
            Next
          </button>
        </div>
      </div>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      )}
      <div className="vc-crm-table">
        <table aria-busy={loading}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Roles</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td>
                  <button className="vc-crm-title" type="button" disabled={saving} onClick={() => void open(doc.id)}>
                    {doc.label}
                  </button>
                </td>
                <td>{doc.kind}</td>
                <td>{doc.roles.join(', ') || '—'}</td>
                <td>{doc.tags.join(', ') || '—'}</td>
              </tr>
            ))}
            {!docs.length && (
              <tr>
                <td colSpan={4}>
                  {loading ? 'Loading contacts…' : 'No contacts match this view.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <dialog
        className="vc-crm-dialog"
        ref={dialog}
        aria-labelledby="vc-contact-heading"
        onCancel={(event) => {
          event.preventDefault()
          close()
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <header>
            <h2 id="vc-contact-heading">{editor === 'new' ? 'New contact' : editor?.label}</h2>
            <button type="button" onClick={close} disabled={saving} aria-label="Close contact">
              ×
            </button>
          </header>
          {editor && editor !== 'new' && (
            <div className="vc-crm-toolbar" role="tablist" aria-label="Contact details">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'profile'}
                onClick={() => switchTab('profile')}
              >
                Shared profile
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'chapter'}
                onClick={() => switchTab('chapter')}
              >
                Chapter details
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'corrections'}
                disabled={saving}
                onClick={() => switchTab('corrections')}
              >
                Corrections
              </button>
              <button type="button" role="tab" aria-selected={tab === 'gifts'} onClick={() => switchTab('gifts')}>Gifts</button>
              <button type="button" role="tab" aria-selected={tab === 'relationships'} onClick={() => switchTab('relationships')}>Relationships</button>
              <button type="button" role="tab" aria-selected={tab === 'communications'} onClick={() => switchTab('communications')}>Communications</button>
              <button type="button" role="tab" aria-selected={tab === 'giving'} onClick={() => switchTab('giving')}>Pledges and recurring</button>
              <button type="button" role="tab" aria-selected={tab === 'memberships'} onClick={() => switchTab('memberships')}>Memberships</button>
              <button type="button" role="tab" aria-selected={tab === 'opportunities'} onClick={() => switchTab('opportunities')}>Opportunities</button>
              <button type="button" role="tab" aria-selected={tab === 'volunteers'} onClick={() => switchTab('volunteers')}>Volunteers</button>
              <button type="button" role="tab" aria-selected={tab === 'correspondence'} onClick={() => switchTab('correspondence')}>Receipts and correspondence</button>
              <button type="button" role="tab" aria-selected={tab === 'attachments'} onClick={() => switchTab('attachments')}>Private attachments</button>
              <button type="button" role="tab" aria-selected={tab === 'timeline'} onClick={() => switchTab('timeline')}>Timeline</button>
            </div>
          )}
          <div className="vc-crm-dialog-body">
            {tab === 'gifts' && editor && editor !== 'new' && site && <ContactGifts api={api} site={site.id} contact={editor.id} onDirty={setDirty} onSaving={setSaving} />}
            {tab === 'relationships' && editor && editor !== 'new' && site && <ContactRelationships key={`${site.id}:${editor.id}`} api={api} site={site.id} contact={editor.id} onDirty={setDirty} onSaving={setSaving} />}
            {tab === 'communications' && editor && editor !== 'new' && site && <ContactActivities key={`${site.id}:${editor.id}`} api={api} site={site.id} contact={editor.id} onDirty={setDirty} onSaving={setSaving} />}
            {tab === 'giving' && editor && editor !== 'new' && site && <CommitmentWorkspace key={`${site.id}:${editor.id}`} api={api} site={site.id} contact={editor.id} onDirty={setDirty} onSaving={setSaving} />}
            {tab === 'memberships' && editor && editor !== 'new' && site && <MembershipWorkspace key={`${site.id}:${editor.id}`} api={api} site={site.id} contact={editor.id} onDirty={setDirty} onSaving={setSaving} />}
            {tab === 'opportunities' && editor && editor !== 'new' && site && <OpportunityWorkspace key={`${site.id}:${editor.id}`} api={api} site={site.id} contact={editor.id} onDirty={setDirty} onSaving={setSaving} />}
            {tab === 'volunteers' && editor && editor !== 'new' && site && <VolunteerWorkspace key={`${site.id}:${editor.id}`} api={api} site={site.id} contact={editor.id} onDirty={setDirty} onSaving={setSaving} />}
            {tab === 'correspondence' && editor && editor !== 'new' && site && <CorrespondenceWorkspace key={`${site.id}:${editor.id}`} api={api} site={site.id} contact={editor.id} onDirty={setDirty} onSaving={setSaving} />}
            {tab === 'attachments' && editor && editor !== 'new' && site && <AttachmentWorkspace api={api} site={site.id} link={{type:'contact',id:editor.id}} onDirty={setDirty} onSaving={setSaving} onDenied={loseAccess} />}
            {tab === 'timeline' && editor && editor !== 'new' && site && <ContactTimeline api={api} site={site.id} contact={editor.id} onOpen={switchTab} onSaving={setSaving} onDenied={loseAccess} />}
            {tab === 'corrections' && editor && editor !== 'new' && site && (
              <ContactCorrections
                api={api}
                site={site.id}
                contact={editor.id}
                onDirty={setDirty}
                onSaving={setSaving}
                onAccessLost={loseAccess}
              />
            )}
            {tab === 'profile' && (
              <fieldset disabled={!editable || saving}>
                <legend>Shared profile</legend>
                <label>
                  Contact type
                  <select
                    value={profile.kind}
                    disabled={editor !== 'new'}
                    onChange={(event) =>
                      change({ kind: event.target.value as ContactProfile['kind'] })
                    }
                  >
                    <option value="person">Person</option>
                    <option value="organization">Organization</option>
                  </select>
                </label>
                <div className="vc-crm-fields">
                  {(profile.kind === 'organization'
                    ? (['organizationName'] as const)
                    : (['firstName', 'lastName', 'preferredName'] as const)
                  ).map((key) => (
                    <label key={key}>
                      {
                        {
                          organizationName: 'Organization name',
                          firstName: 'First name',
                          lastName: 'Last name',
                          preferredName: 'Preferred name',
                        }[key]
                      }
                      <input
                        value={profile[key]}
                        onChange={(event) => change({ [key]: event.target.value })}
                      />
                    </label>
                  ))}
                </div>
                <h3>Contact methods</h3>
                {profile.methods.map((method, index) => (
                  <div className="vc-crm-fields" key={index}>
                    <label>
                      Type
                      <select
                        value={method.kind}
                        onChange={(event) =>
                          change({
                            methods: profile.methods.map((item, i) =>
                              i === index
                                ? { ...item, kind: event.target.value as 'email' | 'phone' }
                                : item,
                            ),
                          })
                        }
                      >
                        <option value="email">Email</option>
                        <option value="phone">Phone</option>
                      </select>
                    </label>
                    <label>
                      Value
                      <input
                        type={method.kind === 'email' ? 'email' : 'tel'}
                        required
                        value={method.value}
                        onChange={(event) =>
                          change({
                            methods: profile.methods.map((item, i) =>
                              i === index ? { ...item, value: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Label
                      <input
                        value={method.label}
                        onChange={(event) =>
                          change({
                            methods: profile.methods.map((item, i) =>
                              i === index ? { ...item, label: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="vc-crm-check">
                      <input
                        type="checkbox"
                        checked={method.primary}
                        onChange={(event) =>
                          change({
                            methods: profile.methods.map((item, i) =>
                              i === index
                                ? { ...item, primary: event.target.checked }
                                : event.target.checked && item.kind === method.kind
                                  ? { ...item, primary: false }
                                  : item,
                            ),
                          })
                        }
                      />
                      Primary {method.kind}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        change({ methods: profile.methods.filter((_, i) => i !== index) })
                      }
                    >
                      Remove method
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={profile.methods.length >= 20}
                  onClick={() =>
                    change({
                      methods: [
                        ...profile.methods,
                        { kind: 'email', value: '', label: '', primary: false },
                      ],
                    })
                  }
                >
                  Add contact method
                </button>
                <h3>Addresses</h3>
                {profile.addresses.map((address, index) => (
                  <fieldset key={index}>
                    <legend>Address {index + 1}</legend>
                    <div className="vc-crm-fields">
                      {(['label', 'lines', 'city', 'region', 'postalCode', 'country'] as const).map(
                        (key) => (
                          <label key={key}>
                            {
                              {
                                label: 'Address label',
                                lines: 'Street address',
                                city: 'City',
                                region: 'Region / state',
                                postalCode: 'Postal code',
                                country: 'Country',
                              }[key]
                            }
                            {key === 'lines' ? (
                              <textarea
                                value={address[key]}
                                onChange={(event) =>
                                  change({
                                    addresses: profile.addresses.map((item, i) =>
                                      i === index ? { ...item, [key]: event.target.value } : item,
                                    ),
                                  })
                                }
                              />
                            ) : (
                              <input
                                value={address[key]}
                                onChange={(event) =>
                                  change({
                                    addresses: profile.addresses.map((item, i) =>
                                      i === index ? { ...item, [key]: event.target.value } : item,
                                    ),
                                  })
                                }
                              />
                            )}
                          </label>
                        ),
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        change({ addresses: profile.addresses.filter((_, i) => i !== index) })
                      }
                    >
                      Remove address
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  disabled={profile.addresses.length >= 10}
                  onClick={() =>
                    change({
                      addresses: [
                        ...profile.addresses,
                        { label: '', lines: '', city: '', region: '', postalCode: '', country: '' },
                      ],
                    })
                  }
                >
                  Add address
                </button>
                <h3>Communication preferences</h3>
                <div className="vc-crm-fields">
                  {(
                    ['emailAllowed', 'phoneAllowed', 'mailAllowed', 'volunteerAllowed'] as const
                  ).map((key) => (
                    <label className="vc-crm-check" key={key}>
                      <input
                        type="checkbox"
                        checked={profile.communication[key]}
                        onChange={(event) =>
                          change({
                            communication: {
                              ...profile.communication,
                              [key]: event.target.checked,
                            },
                          })
                        }
                      />
                      {
                        {
                          emailAllowed: 'Allow email',
                          phoneAllowed: 'Allow phone',
                          mailAllowed: 'Allow mail',
                          volunteerAllowed: 'Allow volunteer outreach',
                        }[key]
                      }
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {(editor === 'new' || tab === 'chapter') && (
              <fieldset disabled={saving || !editable}>
                <legend>Chapter roles</legend>
                <div className="vc-crm-fields">
                  {constituentRoles.map((item) => (
                    <label className="vc-crm-check" key={item}>
                      <input
                        type="checkbox"
                        checked={roles.includes(item)}
                        onChange={(event) => {
                          setRoles((value) =>
                            event.target.checked
                              ? [...value, item]
                              : value.filter((role) => role !== item),
                          )
                          setDirty(true)
                          operation.current = null
                        }}
                      />
                      {item}
                    </label>
                  ))}
                </div>
                <label>
                  Tags, separated by commas
                  <input
                    value={tagInput}
                    onChange={(event) => {
                      setTagInput(event.target.value)
                      setDirty(true)
                      operation.current = null
                    }}
                  />
                </label>
              </fieldset>
            )}
            {editor &&
              editor !== 'new' &&
              tab === 'profile' &&
              (editable ? (
                <label className="vc-crm-check">
                  <input
                    type="checkbox"
                    required
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  This updates the shared contact profile used by authorized chapters.
                </label>
              ) : (
                <label>
                  Request a correction
                  <textarea
                    required
                    maxLength={4000}
                    value={correction}
                    onChange={(event) => {
                      setCorrection(event.target.value)
                      setDirty(true)
                      operation.current = null
                    }}
                  />
                </label>
              ))}
            {saveError && <p role="alert">{saveError}</p>}
          </div>
          <footer>
            <button type="button" disabled={saving} onClick={close}>
              Cancel
            </button>
            {tab !== 'corrections' && tab !== 'gifts' && tab !== 'relationships' && tab !== 'communications' && tab !== 'giving' && tab !== 'memberships' && tab !== 'opportunities' && tab !== 'volunteers' && tab !== 'correspondence' && tab !== 'attachments' && tab !== 'timeline' && (
              <button
                className="vc-crm-primary"
                type="submit"
                disabled={
                  saving ||
                  (tab === 'chapter' && !editable) ||
                  (tab === 'profile' && editor !== 'new' && editable && !confirmed)
                }
              >
                {saving
                  ? 'Saving…'
                  : tab === 'chapter'
                    ? 'Save chapter details'
                    : editable
                      ? 'Save contact'
                      : 'Request correction'}
              </button>
            )}
          </footer>
        </form>
      </dialog>
    </Gutter>
  )
}
