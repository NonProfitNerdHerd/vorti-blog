'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Keep the full-page editor in sync with CRM URL changes. */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
import type { ActivityCreate } from './ContactActivityOverview'
import { ContactComments } from './ContactComments'
import { RecordTasks } from './RecordTasks'
import { ContactButton, ContactEditAction, ContactFacts, ContactIcon, ContactSectionHeading, ContactStatus, ContactTab } from './ContactUI'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { redirectToLogin } from '../components/auth-return'
import './contact-ui.css'
import './workspace.css'

type Detail = ContactSummary & {
  profile: ContactProfile
  canEditProfile: boolean
  canEditChapter: boolean
}
type Cursor = { label: string; id: string }
type Context = { site: { id: string; name: string }; canCreate: boolean }
type ContactPage = { docs: ContactSummary[]; total: number; next: Cursor | null }
type InlineEditor = 'identity' | 'methods' | 'addresses' | 'preferences' | 'chapter' | null
const contactTabs = [
  'profile',
  'chapter',
  'corrections',
  'gifts',
  'relationships',
  'communications',
  'giving',
  'memberships',
  'opportunities',
  'volunteers',
  'correspondence',
  'attachments',
  'timeline',
  'comments',
  'tasks',
] as const
type ContactTab = (typeof contactTabs)[number]
const informationTabs = ['profile', 'chapter', 'communications', 'relationships', 'corrections', 'attachments'] as const
const isInformation = (value: ContactTab) => (informationTabs as readonly string[]).includes(value)
function resolvedTab(value: string | null, info: string | null): ContactTab {
  if (value === 'activity') return 'timeline'
  if (value === 'information') return (informationTabs as readonly string[]).includes(info || '') ? info as ContactTab : 'profile'
  if (value === 'pledges') return 'giving'
  return contactTabs.includes(value as ContactTab) ? value as ContactTab : 'timeline'
}
function tabURL(value: ContactTab) {
  return value === 'timeline' ? 'activity' : isInformation(value) ? 'information' : value === 'giving' ? 'pledges' : value
}
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
  const params = useSearchParams()
  const requestedContact = params.get('contact')
  const requestedTab = params.get('contactTab')
  const requestedNew = params.get('newContact') === '1'
  const openedLocation = useRef('')
  const lastLocation = useRef('')
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
  const [followUp, setFollowUp] = useState<{ id: string; subject: string } | null>(null)
  const [createIntent, setCreateIntent] = useState<ActivityCreate | null>(null)
  const [inlineEditor, setInlineEditor] = useState<InlineEditor>(null)
  const contactFormRef = useRef<HTMLFormElement>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const [tabEdges, setTabEdges] = useState({ left: false, right: false })
  const [profileDirty, setProfileDirty] = useState(false),
    [chapterDirty, setChapterDirty] = useState(false),
    [childDirty, setChildDirty] = useState<Record<string, boolean>>({}),
    [parentSaving, setParentSaving] = useState(false),
    [childSaving, setChildSaving] = useState<Record<string, boolean>>({}),
    [saveError, setSaveError] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [correction, setCorrection] = useState('')
  const dirty = profileDirty || chapterDirty || Object.values(childDirty).some(Boolean)
  const saving = parentSaving || Object.entries(childSaving).some(([section, busy]) => section !== 'timeline' && busy)
  const clearDirty = useCallback(() => { setProfileDirty(false); setChapterDirty(false); setChildDirty({}) }, [])
  const clearSaving = useCallback(() => { setParentSaving(false); setChildSaving({}) }, [])
  const sections = useMemo(() => [
    'comments', 'tasks', 'gifts', 'giving', 'memberships', 'opportunities', 'volunteers',
    'correspondence', 'timeline', 'communications', 'relationships', 'corrections', 'attachments',
  ], [])
  const dirtyCallbacks = useMemo(() => Object.fromEntries(sections.map(section => [section,
    (value: boolean) => setChildDirty(current => ({ ...current, [section]: value })),
  ])) as Record<string, (value: boolean) => void>, [sections])
  const savingCallbacks = useMemo(() => Object.fromEntries(sections.map(section => [section,
    (value: boolean) => setChildSaving(current => ({ ...current, [section]: value })),
  ])) as Record<string, (value: boolean) => void>, [sections])
  const markChildDirty = (section: string) => dirtyCallbacks[section]
  const markChildSaving = (section: string) => savingCallbacks[section]
  const operation = useRef<string | null>(null),
    requestSequence = useRef(0)
  const accessGeneration = useRef(0)
  const pinnedSite = useRef<string | null>(null)
  const { binding } = useAdminSite()
  const loseAccess = useCallback((): void => {
    accessGeneration.current++
    requestSequence.current++
    setEditor(null)
    setProfile(empty())
    setSite(null)
    setDocs([])
    setTotal(0)
    setCanCreate(false)
    clearDirty()
    setLoading(false)
    clearSaving()
    setInlineEditor(null)
    operation.current = null
    setError('Your CRM access changed. Reload the workspace to check your current permissions.')
  }, [clearDirty, clearSaving])
  const [tab, setTab] = useState<
      | 'profile'
      | 'chapter'
      | 'corrections'
      | 'gifts'
      | 'relationships'
      | 'communications'
      | 'giving'
      | 'memberships'
      | 'opportunities'
      | 'volunteers'
      | 'correspondence'
      | 'attachments'
      | 'timeline'
      | 'comments'
      | 'tasks'
    >('timeline'),
    [tagInput, setTagInput] = useState('')
  const read = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { ...init, cache: 'no-store' }),
      data = (await response.json()) as T & { message?: string }
    if (response.status === 401) redirectToLogin(admin, '/login')
    if (!response.ok)
      throw Object.assign(new Error(data.message || 'Unable to load CRM. Try again.'), {
        status: response.status,
      })
    return data
  }, [admin])
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current
    setLoading(true)
    setError('')
    try {
      const selected = pinnedSite.current || new URL(window.location.href).searchParams.get('site')
      const context = await read<Context>(
        api + '/crm/context' + (selected ? '?site=' + encodeURIComponent(selected) : ''),
      )
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
  useEffect(() => { lastLocation.current = window.location.href })
  useEffect(() => {
    const back = () => {
      if (saving || (dirty && !window.confirm('Discard the unsaved contact changes?'))) {
        window.history.pushState(null, '', lastLocation.current)
        return
      }
      lastLocation.current = window.location.href
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [dirty, saving])
  useEffect(() => {
    const navigate = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-vc-crm-navigation]'))
        return
      if (!dirty || !(event.target instanceof Element) || !event.target.closest('a[href]')) return
      const link = event.target.closest('a[href]') as HTMLAnchorElement
      if (
        (link.target && link.target !== '_self') ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return
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
    setProfileDirty(true)
    operation.current = null
  }
  const close = () => {
    if (saving || (dirty && !window.confirm('Discard the unsaved contact changes?'))) return
    setEditor(null)
    clearDirty()
    setInlineEditor(null)
    operation.current = null
    const location = new URL(window.location.href)
    location.searchParams.delete('contact')
    location.searchParams.delete('contactTab')
    location.searchParams.delete('infoSection')
    location.searchParams.delete('newContact')
    location.searchParams.delete('receiptGift')
    location.searchParams.delete('renewalMembership')
    window.history.pushState(null, '', location)
    openedLocation.current = ''
  }
  const open = useCallback(
    async (id?: string, fromURL = false) => {
      if (!site) return
      setSaveError('')
      setInlineEditor(null)
      const requested = new URL(window.location.href)
      const nextTab: ContactTab = id && requested.searchParams.get('contact') === id &&
        requested.searchParams.get('site') === site.id
        ? resolvedTab(requested.searchParams.get('contactTab'), requested.searchParams.get('infoSection'))
        : 'timeline'
      setTab(nextTab)
      setTagInput('')
      setConfirmed(false)
      setCorrection('')
      clearDirty()
      operation.current = null
      if (!id) {
        if (!canCreate) {
          setError('You do not have permission to create a contact in this chapter.')
          return
        }
        setTab('profile')
        setProfile(empty())
        setRoles(['contact'])
        setEditor('new')
        if (!fromURL) {
          const location = new URL(window.location.href)
          location.searchParams.set('view', 'contacts')
          location.searchParams.set('site', site.id)
          location.searchParams.set('newContact', '1')
          location.searchParams.delete('contact')
          location.searchParams.delete('contactTab')
          window.history.pushState(null, '', location)
        }
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
        openedLocation.current = `${site.id}:${id}`
        const location = new URL(window.location.href)
        location.searchParams.set('view', 'contacts')
        location.searchParams.set('site', site.id)
        location.searchParams.set('contact', id)
        location.searchParams.delete('newContact')
        location.searchParams.set('contactTab', tabURL(nextTab))
        if (isInformation(nextTab)) location.searchParams.set('infoSection', nextTab)
        if (requested.searchParams.get('contact') !== id) {
          location.searchParams.delete('receiptGift')
          location.searchParams.delete('renewalMembership')
        }
        if (!fromURL) window.history.pushState(null, '', location)
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
    },
    [site, api, read, loseAccess, canCreate, clearDirty],
  )
  useEffect(() => {
    if (!site) return
    if (requestedNew && !requestedContact) {
      // The URL update after creation can precede the router search-param update.
      // Keep the newly opened contact instead of reopening the stale new form.
      const live = new URL(window.location.href).searchParams
      if (live.get('contact') && live.get('newContact') !== '1') return
      if (editor !== 'new') void open(undefined, true)
      return
    }
    if (!requestedContact) {
      if (editor) {
        setEditor(null)
        clearDirty()
        openedLocation.current = ''
      }
      return
    }
    if (openedLocation.current === `${site.id}:${requestedContact}`) {
      if (params.get('site') === site.id) {
        setTab(resolvedTab(requestedTab, params.get('infoSection')))
      }
      return
    }
    openedLocation.current = `${site.id}:${requestedContact}`
    void open(requestedContact, true)
  }, [site, requestedContact, requestedTab, requestedNew, params, open, editor, clearDirty])
  const updateTabEdges = useCallback(() => {
    const list = tabListRef.current
    if (!list) return
    setTabEdges({
      left: list.scrollLeft > 2,
      right: list.scrollLeft + list.clientWidth < list.scrollWidth - 2,
    })
  }, [])
  useEffect(() => {
    const list = tabListRef.current
    if (!list) return
    updateTabEdges()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateTabEdges)
    observer.observe(list)
    return () => observer.disconnect()
  }, [editor, updateTabEdges])
  useEffect(() => {
    const list = tabListRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    updateTabEdges()
  }, [tab, editor, updateTabEdges])
  useEffect(() => {
    if (!inlineEditor) return
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.vc-crm-detail .vc-crm-inline-editor :is(input, select, textarea, button):not([disabled])')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [inlineEditor])
  const trapModalFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
    )).filter(control => control.getClientRects().length > 0)
    if (!controls.length) return
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }
  const profileEditable = editor === 'new' || !!editor?.canEditProfile
  const chapterEditable = editor === 'new' || !!editor?.canEditChapter
  const cancelInline = () => {
    if (!editor || editor === 'new') return
    const section = inlineEditor
    if (inlineEditor === 'chapter') {
      setRoles(editor.roles)
      setTagInput(editor.tags.join(', '))
      setChapterDirty(false)
    } else {
      setProfile(editor.profile)
      setProfileDirty(false)
      setConfirmed(false)
    }
    setInlineEditor(null)
    setSaveError('')
    operation.current = null
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.vc-crm-detail [data-inline-edit="${section}"]`)?.focus())
  }
  const beginInline = (section: Exclude<InlineEditor, null>) => {
    if (!editor || editor === 'new' || saving) return
    if (inlineEditor && inlineEditor !== section) {
      if ((profileDirty || chapterDirty) && !window.confirm('Discard unsaved contact changes?')) return
      cancelInline()
    }
    setInlineEditor(section)
    setSaveError('')
    if (section === 'methods' && !profile.methods.length) {
      setProfile(value => ({ ...value, methods: [{ kind: 'email', value: '', label: '', primary: false }] }))
      setProfileDirty(true)
    }
    if (section === 'addresses' && !profile.addresses.length) {
      setProfile(value => ({ ...value, addresses: [{ label: '', lines: '', city: '', region: '', postalCode: '', country: '' }] }))
      setProfileDirty(true)
    }
  }
  const switchTab = (
    nextTab:
      | 'profile'
      | 'chapter'
      | 'corrections'
      | 'gifts'
      | 'relationships'
      | 'communications'
      | 'giving'
      | 'memberships'
      | 'opportunities'
      | 'volunteers'
      | 'correspondence'
      | 'attachments'
      | 'timeline'
      | 'comments'
      | 'tasks',
    confirmedNavigation = false,
    activity?: { id: string; subject: string },
  ) => {
    let discardedInline = false
    if (inlineEditor && tab !== nextTab && isInformation(tab) && isInformation(nextTab)) {
      if ((profileDirty || chapterDirty) && !window.confirm('Discard unsaved contact changes?')) return false
      cancelInline()
      discardedInline = true
    }
    if (
      saving ||
      !editor ||
      editor === 'new' ||
      (tab === nextTab && !isInformation(tab)) ||
      (dirty && !confirmedNavigation && !discardedInline && tab !== nextTab &&
        !window.confirm('Discard unsaved changes before changing tabs?'))
    )
      return false
    if (tab !== nextTab) {
      setInlineEditor(null)
      setProfile(editor.profile)
      setRoles(editor.roles)
      setTagInput(editor.tags.join(', '))
      clearDirty()
      setSaveError('')
    }
    if (nextTab === 'tasks') setFollowUp(activity || null)
    setCreateIntent(null)
    setTab(nextTab)
    const location = new URL(window.location.href)
    location.searchParams.set('contactTab', tabURL(nextTab))
    if (isInformation(nextTab)) location.searchParams.set('infoSection', nextTab)
    else location.searchParams.delete('infoSection')
    window.history.replaceState(null, '', location)
    operation.current = null
    return true
  }
  const createActivity = (kind: ActivityCreate) => {
    const target: ContactTab = kind === 'gift' ? 'gifts' : kind === 'pledge' || kind === 'recurring' ? 'giving'
      : kind === 'membership' ? 'memberships' : kind === 'task' ? 'tasks'
        : kind === 'volunteer' ? 'volunteers' : 'communications'
    if (switchTab(target)) setCreateIntent(kind)
  }
  const save = async (section: 'profile' | 'chapter' = 'profile') => {
    if (
      !site ||
      !editor ||
      saving ||
      (!isInformation(tab) && editor !== 'new')
    )
      return
    const editable = section === 'chapter' ? chapterEditable : profileEditable
    if (section === 'chapter' && !chapterEditable) return
    if (editable && editor !== 'new') {
      const controls = contactFormRef.current?.querySelectorAll(
        '.vc-crm-inline-editor input, .vc-crm-inline-editor select, .vc-crm-inline-editor textarea',
      )
      const invalid = Array.from(controls || []).find(control => !(control as HTMLInputElement).checkValidity()) as HTMLInputElement | undefined
      if (invalid) { invalid.reportValidity(); return }
    }
    if (section === 'profile' && editable && editor !== 'new' && !confirmed) {
      setSaveError('Confirm the shared profile update before saving.')
      return
    }
    setParentSaving(true)
    setSaveError('')
    operation.current ||= crypto.randomUUID()
    const creating = editor === 'new'
    try {
      const saved = await read<{ doc: { id: string } }>(api + '/crm/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site: site.id,
          operationKey: operation.current,
          action: creating
            ? 'create'
            : section === 'chapter'
              ? 'update-chapter'
              : editable
                ? 'update-profile'
                : 'request-correction',
          id: creating ? undefined : editor.id,
          expectedRevision: creating
            ? undefined
            : section === 'chapter'
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
      if (creating) clearDirty()
      else if (section === 'profile') setProfileDirty(false)
      else setChapterDirty(false)
      operation.current = null
      setConfirmed(false)
      const id = saved.doc.id || (editor !== 'new' ? editor.id : '')
      if (id) {
        const detail = await read<{ doc: Detail }>(api + '/crm/contacts?' + new URLSearchParams({ site: site.id, id }))
        setEditor(detail.doc)
        if (section === 'profile' || !profileDirty) setProfile(detail.doc.profile)
        if (section === 'chapter' || !chapterDirty) {
          setRoles(detail.doc.roles)
          setTagInput(detail.doc.tags.join(', '))
        }
        if (creating) {
          setTab('timeline')
          openedLocation.current = `${site.id}:${id}`
          const location = new URL(window.location.href)
          location.searchParams.delete('newContact')
          location.searchParams.set('contact', id)
          location.searchParams.set('contactTab', 'activity')
          window.history.replaceState(null, '', location)
        }
      }
      setNotice(
        editable
          ? creating
            ? 'Contact created.'
            : section === 'chapter'
              ? 'Chapter details updated.'
              : 'Shared contact profile updated.'
          : 'Correction request submitted.',
      )
      setInlineEditor(null)
      if (inlineEditor) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.vc-crm-detail [data-inline-edit="${inlineEditor}"]`)?.focus())
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
      setParentSaving(false)
    }
  }
  const inlineActions = (section: Exclude<InlineEditor, 'chapter' | null>) =>
    editor !== 'new' && inlineEditor === section && profileEditable && <div className="vc-crm-inline-actions" data-modal-part={section}>
      <label className="vc-crm-check vc-crm-confirm">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Confirm this update to the shared contact profile used by authorized chapters.
      </label>
      <div className="vc-crm-section-actions">
        <ContactButton type="button" disabled={saving} onClick={cancelInline}>Cancel</ContactButton>
        <ContactButton variant="primary" type="button" disabled={saving || !profileDirty || !confirmed}
          onClick={() => void save('profile')}>{parentSaving ? 'Saving…' : 'Save changes'}</ContactButton>
      </div>
      {saveError && <p className="vc-crm-inline-error" role="alert">{saveError}</p>}
    </div>
  const showDetail = Boolean(editor || requestedContact || requestedNew)
  return (
    <Gutter className={showDetail ? 'vc-crm vc-crm-detail-open' : 'vc-crm'}>
      <div hidden={showDetail}>
      <header className="vc-crm-heading">
        <div>
          <h1>VortiCause</h1>
          <p>{site?.name || 'Constituent workspace'}</p>
          {binding && (
            <Link
              href={`${admin}/globals/site-settings?tab=SubSites&site=${encodeURIComponent(binding.site.id)}`}
            >
              Sites and permissions
            </Link>
          )}
        </div>
        <div>
          <button type="button" disabled={loading} onClick={() => void refresh()}>
            Refresh
          </button>
          {canCreate && (
            <button
              className="vc-crm-primary"
              type="button"
              disabled={saving}
              onClick={() => void open()}
            >
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
                  <button
                    className="vc-crm-title"
                    type="button"
                    disabled={saving}
                    onClick={() => void open(doc.id)}
                  >
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
      </div>
      {showDetail && <section className="vc-crm-detail" aria-labelledby="vc-contact-heading">
        {editor ? <form ref={contactFormRef} onKeyDown={(event) => {
          if (event.key === 'Escape' && inlineEditor) { event.preventDefault(); cancelInline() }
        }} onSubmit={(event) => { event.preventDefault(); void save(inlineEditor === 'chapter' ? 'chapter' : 'profile') }}>
          <header className="vc-crm-detail-header">
            <div className="vc-crm-detail-header-main">
              <div>
                <p className="vc-crm-eyebrow">Contacts{site ? ` / ${site.name}` : ''}</p>
                <h1 id="vc-contact-heading">{editor === 'new' ? 'New contact' : editor.label}</h1>
              </div>
              {editor !== 'new' && <div className="vc-crm-detail-header-actions">
                <ContactButton type="button" onClick={close} disabled={saving}>Back to contacts</ContactButton>
                {profileEditable && !inlineEditor && <ContactButton variant="primary" type="button"
                  disabled={saving || dirty} onClick={() => { switchTab('profile'); beginInline('identity') }}>
                  Edit details
                </ContactButton>}
                <details className="vc-crm-more-actions">
                  <summary>More actions <ContactIcon name="chevron-down" /></summary>
                  <div><button type="button" onClick={() => {
                    void navigator.clipboard.writeText(window.location.href)
                      .then(() => setNotice('Contact link copied.'))
                      .catch(() => setSaveError('Unable to copy the contact link.'))
                  }}>Copy contact link</button></div>
                </details>
              </div>}
            </div>
            {editor !== 'new' && <p className="vc-crm-contact-methods">
              {(() => {
                const phone = profile.methods.find(method => method.kind === 'phone' && method.primary)?.value ||
                  profile.methods.find(method => method.kind === 'phone')?.value
                const email = profile.methods.find(method => method.kind === 'email' && method.primary)?.value ||
                  profile.methods.find(method => method.kind === 'email')?.value
                return <>{phone && <a href={`tel:${phone}`}>{phone}</a>}{email && <a href={`mailto:${email}`}>{email}</a>}</>
              })()}
            </p>}
          </header>
          {notice && <ContactStatus>{notice}</ContactStatus>}
          {editor !== 'new' && <div className="vc-crm-tabs-shell" data-can-scroll-left={tabEdges.left} data-can-scroll-right={tabEdges.right}>
            <button className="vc-crm-tab-scroll" type="button" aria-label="Scroll contact tabs left"
              disabled={!tabEdges.left} onClick={() => tabListRef.current?.scrollBy?.({ left: -280, behavior: 'smooth' })}>‹</button>
            <div ref={tabListRef} className="vc-crm-detail-tabs" role="tablist" aria-label="Constituent details" onScroll={updateTabEdges}>
            {([
              ['timeline', 'Activity'], ['profile', 'Information'], ['comments', 'Comments'],
              ['tasks', 'Tasks'], ['gifts', 'Gifts'], ['giving', 'Pledges and recurring'],
              ['memberships', 'Memberships'], ['opportunities', 'Opportunities'],
              ['volunteers', 'Volunteers'], ['correspondence', 'Receipts and Correspondence'],
            ] as const).map(([value, label]) => <ContactTab key={value} type="button"
              selected={tabURL(tab) === tabURL(value)}
              id={`vc-crm-tab-${tabURL(value)}`}
              tabIndex={tabURL(tab) === tabURL(value) ? 0 : -1}
              aria-controls="vc-crm-tabpanel"
              onKeyDown={(event) => {
                if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
                const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || [])
                const index = tabs.indexOf(event.currentTarget)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
                  (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                event.preventDefault()
                tabs[next]?.focus()
                tabs[next]?.click()
              }} onClick={() => switchTab(value)}>{label}</ContactTab>)}
            </div>
            <button className="vc-crm-tab-scroll" type="button" aria-label="Scroll contact tabs right"
              disabled={!tabEdges.right} onClick={() => tabListRef.current?.scrollBy?.({ left: 280, behavior: 'smooth' })}>›</button>
          </div>}
          {editor === 'new' && <p>Save this contact to open activity, comments, tasks, and giving records.</p>}
          <div className="vc-crm-dialog-body" id={editor === 'new' ? undefined : 'vc-crm-tabpanel'}
            role={editor === 'new' ? undefined : 'tabpanel'} aria-labelledby={editor === 'new' ? undefined : `vc-crm-tab-${tabURL(tab)}`}>
            {tab === 'comments' && editor && editor !== 'new' && site && <ContactComments
              api={api} site={site.id} contact={editor.id} onDirty={markChildDirty('comments')} onSaving={markChildSaving('comments')} onDenied={loseAccess} />}
            {tab === 'tasks' && editor && editor !== 'new' && site && <RecordTasks
              api={api} admin={admin} site={site.id} link={{ type: 'contact', id: editor.id }}
              autoCreate={createIntent === 'task'}
              activity={followUp?.id} defaultTitle={followUp?.subject}
              onDirty={markChildDirty('tasks')} onSaving={markChildSaving('tasks')} />}
            {tab === 'gifts' && editor && editor !== 'new' && site && (
              <ContactGifts
                api={api}
                site={site.id}
                contact={editor.id}
                autoCreate={createIntent === 'gift'}
                onDirty={markChildDirty('gifts')}
                onSaving={markChildSaving('gifts')}
              />
            )}
            {tab === 'giving' && editor && editor !== 'new' && site && (
              <CommitmentWorkspace
                key={`${site.id}:${editor.id}`}
                api={api}
                site={site.id}
                contact={editor.id}
                autoCreate={createIntent === 'pledge' || createIntent === 'recurring' ? createIntent : undefined}
                onDirty={markChildDirty('giving')}
                onSaving={markChildSaving('giving')}
              />
            )}
            {tab === 'memberships' && editor && editor !== 'new' && site && (
              <MembershipWorkspace
                key={`${site.id}:${editor.id}`}
                api={api}
                site={site.id}
                contact={editor.id}
                autoCreate={createIntent === 'membership'}
                onDirty={markChildDirty('memberships')}
                onSaving={markChildSaving('memberships')}
              />
            )}
            {tab === 'opportunities' && editor && editor !== 'new' && site && (
              <OpportunityWorkspace
                key={`${site.id}:${editor.id}`}
                api={api}
                site={site.id}
                contact={editor.id}
                onDirty={markChildDirty('opportunities')}
                onSaving={markChildSaving('opportunities')}
              />
            )}
            {tab === 'volunteers' && editor && editor !== 'new' && site && (
              <VolunteerWorkspace
                key={`${site.id}:${editor.id}`}
                api={api}
                site={site.id}
                contact={editor.id}
                initialView={createIntent === 'volunteer' ? 'hours' : undefined}
                onDirty={markChildDirty('volunteers')}
                onSaving={markChildSaving('volunteers')}
              />
            )}
            {tab === 'correspondence' && editor && editor !== 'new' && site && (
              <CorrespondenceWorkspace
                key={`${site.id}:${editor.id}`}
                api={api}
                site={site.id}
                contact={editor.id}
                initialGift={
                  requestedContact === editor.id && params.get('site') === site.id
                    ? params.get('receiptGift') || undefined
                    : undefined
                }
                initialMembership={
                  requestedContact === editor.id && params.get('site') === site.id
                    ? params.get('renewalMembership') || undefined
                    : undefined
                }
                onDirty={markChildDirty('correspondence')}
                onSaving={markChildSaving('correspondence')}
              />
            )}
            {tab === 'timeline' && editor && editor !== 'new' && site && (
              <ContactTimeline
                api={api}
                site={site.id}
                contact={editor.id}
                onOpen={switchTab}
                onCreate={createActivity}
                onDenied={loseAccess}
              />
            )}
            {isInformation(tab) && editor !== 'new' && <nav className="vc-crm-info-index" aria-label="Information sections">
              {([
                ['profile', 'Profile'], ['chapter', 'Chapter'], ['communications', 'Communications'],
                ['relationships', 'Relationships'], ['corrections', 'Corrections'], ['attachments', 'Attachments'],
              ] as const).map(([value, label]) => <ContactButton key={value} variant="quiet" type="button"
                aria-current={tab === value ? 'location' : undefined}
                onKeyDown={(event) => {
                  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
                  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button') || [])
                  const index = tabs.indexOf(event.currentTarget)
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
                    (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                  event.preventDefault()
                  tabs[next]?.focus()
                  tabs[next]?.click()
                }} onClick={() => switchTab(value)}>{label}</ContactButton>)}
            </nav>}
            {inlineEditor && <div className="vc-crm-edit-backdrop" aria-hidden="true" onClick={cancelInline} />}
            {(tab === 'profile' || editor === 'new') && <section id="vc-crm-info-profile" className="vc-crm-info-section" data-editing={inlineEditor && inlineEditor !== 'chapter' ? inlineEditor : undefined}
              role={inlineEditor && inlineEditor !== 'chapter' ? 'dialog' : undefined} aria-modal={inlineEditor && inlineEditor !== 'chapter' ? true : undefined}
              onKeyDown={inlineEditor && inlineEditor !== 'chapter' ? trapModalFocus : undefined} aria-labelledby="vc-crm-profile-heading">
              <h2 id="vc-crm-profile-heading">{inlineEditor && inlineEditor !== 'chapter' ? ({ identity: 'Edit identity', methods: 'Contact methods', addresses: 'Addresses', preferences: 'Communication preferences' } as const)[inlineEditor] : 'Shared profile'}</h2>
              {editor !== 'new' && <div className="vc-crm-inline-group" data-modal-part="identity">
                <ContactSectionHeading action={profileEditable && inlineEditor !== 'identity' && <ContactEditAction type="button" data-inline-edit="identity" disabled={saving || !!inlineEditor}
                  onClick={() => beginInline('identity')}>Edit identity</ContactEditAction>}><h3>Identity</h3></ContactSectionHeading>
                {inlineEditor !== 'identity' && <ContactFacts>
                  <div><dt>Contact type</dt><dd>{profile.kind === 'person' ? 'Person' : 'Organization'}</dd></div>
                  {profile.kind === 'organization'
                    ? <div><dt>Organization name</dt><dd>{profile.organizationName || 'Not provided'}</dd></div>
                    : <><div><dt>First name</dt><dd>{profile.firstName || 'Not provided'}</dd></div>
                      <div><dt>Last name</dt><dd>{profile.lastName || 'Not provided'}</dd></div>
                      <div><dt>Preferred name</dt><dd>{profile.preferredName || 'Not provided'}</dd></div></>}
                </ContactFacts>}
              </div>}
              {(editor === 'new' || inlineEditor === 'identity') && <fieldset data-modal-part="identity" disabled={!profileEditable || saving} className="vc-crm-inline-editor">
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
              </fieldset>}
              {inlineActions('identity')}
              {editor !== 'new' && <div className="vc-crm-inline-group" data-modal-part="methods">
                <ContactSectionHeading action={profileEditable && inlineEditor !== 'methods' && <ContactEditAction type="button" data-inline-edit="methods" disabled={saving || !!inlineEditor}
                  onClick={() => beginInline('methods')}>{profile.methods.length ? 'Edit methods' : 'Add contact method'}</ContactEditAction>}><h3>Contact methods</h3></ContactSectionHeading>
                {inlineEditor !== 'methods' && (profile.methods.length ? <ContactFacts>
                  {profile.methods.map((method, index) => <div key={index}><dt>{method.label || (method.kind === 'email' ? 'Email' : 'Phone')}{method.primary ? ' · Primary' : ''}</dt><dd>{method.value}</dd></div>)}
                </ContactFacts> : <p className="vc-crm-empty">No contact methods added.</p>)}
              </div>}
              {(editor === 'new' || inlineEditor === 'methods') && <fieldset data-modal-part="methods" disabled={!profileEditable || saving} className="vc-crm-inline-editor">
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
              </fieldset>}
              {inlineActions('methods')}
              {editor !== 'new' && <div className="vc-crm-inline-group" data-modal-part="addresses">
                <ContactSectionHeading action={profileEditable && inlineEditor !== 'addresses' && <ContactEditAction type="button" data-inline-edit="addresses" disabled={saving || !!inlineEditor}
                  onClick={() => beginInline('addresses')}>{profile.addresses.length ? 'Edit addresses' : 'Add address'}</ContactEditAction>}><h3>Addresses</h3></ContactSectionHeading>
                {inlineEditor !== 'addresses' && (profile.addresses.length ? <div className="vc-crm-address-list">
                  {profile.addresses.map((address, index) => <address key={index}>
                    <strong>{address.label || `Address ${index + 1}`}</strong>
                    <span>{[address.lines, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(', ') || 'No address details'}</span>
                  </address>)}
                </div> : <p className="vc-crm-empty">No addresses added.</p>)}
              </div>}
              {(editor === 'new' || inlineEditor === 'addresses') && <fieldset data-modal-part="addresses" disabled={!profileEditable || saving} className="vc-crm-inline-editor">
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
              </fieldset>}
              {inlineActions('addresses')}
              {editor !== 'new' && <div className="vc-crm-inline-group" data-modal-part="preferences">
                <ContactSectionHeading action={profileEditable && inlineEditor !== 'preferences' && <ContactEditAction type="button" data-inline-edit="preferences" disabled={saving || !!inlineEditor}
                  onClick={() => beginInline('preferences')}>Edit preferences</ContactEditAction>}><h3>Communication preferences</h3></ContactSectionHeading>
                {inlineEditor !== 'preferences' && <ContactFacts className="vc-crm-preferences">
                  {([
                    ['emailAllowed', 'Email'], ['phoneAllowed', 'Phone'], ['mailAllowed', 'Mail'],
                    ['volunteerAllowed', 'Volunteer outreach'],
                  ] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{profile.communication[key] ? 'Allowed' : 'Not allowed'}</dd></div>)}
                </ContactFacts>}
              </div>}
              {(editor === 'new' || inlineEditor === 'preferences') && <fieldset data-modal-part="preferences" disabled={!profileEditable || saving} className="vc-crm-inline-editor">
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
              </fieldset>}
              {inlineActions('preferences')}
              {editor !== 'new' && !profileEditable && <label>Request a correction
                <textarea maxLength={4000} value={correction} onChange={(event) => {
                  setCorrection(event.target.value)
                  setProfileDirty(true)
                  operation.current = null
                }} />
              </label>}
              {editor !== 'new' && !profileEditable && <div className="vc-crm-section-actions"><button className="vc-crm-primary" type="button"
                disabled={saving || !correction.trim()} onClick={() => void save('profile')}>{parentSaving ? 'Saving…' : 'Request correction'}</button></div>}
            </section>}
            {(editor === 'new' || tab === 'chapter') && <section id="vc-crm-info-chapter" className="vc-crm-info-section" data-editing={inlineEditor === 'chapter' ? 'chapter' : undefined}
              role={inlineEditor === 'chapter' ? 'dialog' : undefined} aria-modal={inlineEditor === 'chapter' ? true : undefined}
              onKeyDown={inlineEditor === 'chapter' ? trapModalFocus : undefined} aria-labelledby="vc-crm-chapter-heading">
              <ContactSectionHeading action={editor !== 'new' && chapterEditable && inlineEditor !== 'chapter' && <ContactEditAction type="button" data-inline-edit="chapter" disabled={saving || !!inlineEditor}
                onClick={() => beginInline('chapter')}>Edit chapter details</ContactEditAction>}><h2 id="vc-crm-chapter-heading">Chapter details</h2></ContactSectionHeading>
              {editor !== 'new' && inlineEditor !== 'chapter' && <ContactFacts>
                <div><dt>Roles</dt><dd>{roles.join(', ') || 'None assigned'}</dd></div>
                <div><dt>Tags</dt><dd>{editor.tags.join(', ') || 'No tags'}</dd></div>
              </ContactFacts>}
              {(editor === 'new' || inlineEditor === 'chapter') && <fieldset disabled={saving || !chapterEditable} className="vc-crm-inline-editor">
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
                          setChapterDirty(true)
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
                      setChapterDirty(true)
                      operation.current = null
                    }}
                  />
                </label>
              </fieldset>}
              {editor !== 'new' && inlineEditor === 'chapter' && <div className="vc-crm-section-actions">
                <ContactButton type="button" disabled={saving} onClick={cancelInline}>Cancel</ContactButton>
                <ContactButton variant="primary" type="button" disabled={saving || !chapterDirty}
                  onClick={() => void save('chapter')}>{parentSaving ? 'Saving…' : 'Save chapter details'}</ContactButton>
              </div>}
              {inlineEditor === 'chapter' && saveError && <p className="vc-crm-inline-error" role="alert">{saveError}</p>}
            </section>}
            {tab === 'communications' && editor !== 'new' && site && <section id="vc-crm-info-communications" className="vc-crm-info-section" aria-labelledby="vc-crm-communications-heading">
              <h2 id="vc-crm-communications-heading">Communications</h2>
              <ContactActivities key={`${site.id}:${editor.id}`} api={api} site={site.id} contact={editor.id}
                autoCreate={createIntent === 'communication' && tab === 'communications'}
                onDirty={markChildDirty('communications')} onSaving={markChildSaving('communications')}
                onFollowUp={(activity) => {
                  if (saving || (dirty && !window.confirm('Discard unsaved changes before changing tabs?'))) return
                  switchTab('tasks', true, activity)
                }} />
            </section>}
            {tab === 'relationships' && editor !== 'new' && site && <section id="vc-crm-info-relationships" className="vc-crm-info-section" aria-labelledby="vc-crm-relationships-heading">
              <h2 id="vc-crm-relationships-heading">Relationships</h2>
              <ContactRelationships key={`${site.id}:${editor.id}`} api={api} site={site.id} contact={editor.id}
                onDirty={markChildDirty('relationships')} onSaving={markChildSaving('relationships')} />
            </section>}
            {tab === 'corrections' && editor !== 'new' && site && <section id="vc-crm-info-corrections" className="vc-crm-info-section" aria-labelledby="vc-crm-corrections-heading">
              <h2 id="vc-crm-corrections-heading">Corrections</h2>
              <ContactCorrections api={api} site={site.id} contact={editor.id}
                onDirty={markChildDirty('corrections')} onSaving={markChildSaving('corrections')} onAccessLost={loseAccess} />
            </section>}
            {tab === 'attachments' && editor !== 'new' && site && <section id="vc-crm-info-attachments" className="vc-crm-info-section" aria-labelledby="vc-crm-attachments-heading">
              <h2 id="vc-crm-attachments-heading">Private attachments</h2>
              <AttachmentWorkspace api={api} site={site.id} link={{ type: 'contact', id: editor.id }}
                onDirty={markChildDirty('attachments')} onSaving={markChildSaving('attachments')} onDenied={loseAccess} />
            </section>}
            {saveError && !inlineEditor && <p role="alert">{saveError}</p>}
          </div>
          {editor === 'new' && <footer>
            <button type="button" disabled={saving} onClick={close}>
              Cancel
            </button>
            <button className="vc-crm-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save contact'}
            </button>
          </footer>}
        </form> : <div><p role={error ? 'alert' : 'status'}>{error || 'Loading constituent…'}</p></div>}
      </section>}
    </Gutter>
  )
}
