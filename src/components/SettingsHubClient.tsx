'use client'
import { useEffect, useRef, useState } from 'react'
import { useAuth, useConfig } from '@payloadcms/ui'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import type { SiteSetting, SystemSetting } from '@/payload-types'
import {
  dateFormats,
  timeFormats,
  formatSiteDate,
  formatSiteTime,
} from '@design-system/payload-design-core/content'
import './system-settings.css'

const sections = ['General', 'Reading', 'Privacy', 'Features'] as const
type Section = (typeof sections)[number]
type Choice = { id: number; title?: string; filename?: string; url?: string }
const fields: Record<Section, string[]> = {
  General: ['siteName', 'siteTagline', 'favicon', 'timezone', 'dateFormat', 'timeFormat'],
  Reading: ['homepage', 'blogPage', 'discourageSearchIndexing'],
  Privacy: ['privacyPolicyPage', 'showPrivacyPolicyLink'],
  Features: ['categoriesEnabled', 'tagManagementRoles'],
}
const reference = (v: unknown) => (v && typeof v === 'object' && 'id' in v ? v.id : v)
const values = (doc: object, section: Section) =>
  Object.fromEntries(
    fields[section].map((key) => [key, reference((doc as Record<string, unknown>)[key]) ?? null]),
  )

export function SettingsHubClient({
  initialSite,
  initialSystem,
}: {
  initialSite: SiteSetting
  initialSystem: SystemSetting
}) {
  const { config } = useConfig()
  const { refreshPermissions } = useAuth()
  const router = useRouter()
  const [section, setSection] = useState<Section>('General')
  const [site, setSite] = useState(initialSite)
  const [system, setSystem] = useState(initialSystem)
  const [form, setForm] = useState<Record<string, unknown>>(() => values(initialSite, 'General'))
  const [baseline, setBaseline] = useState(() => JSON.stringify(values(initialSite, 'General')))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [choices, setChoices] = useState<Choice[]>([])
  const [media, setMedia] = useState<Choice[]>([])
  const [lookupError, setLookupError] = useState('')
  const [pageQuery, setPageQuery] = useState('')
  const [mediaQuery, setMediaQuery] = useState('')
  const [zones, setZones] = useState<string[]>(['UTC'])
  const dirty = JSON.stringify(form) !== baseline
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const api = config.routes.api
  useEffect(() => {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf
    if (supported) setZones(['UTC', ...supported('timeZone')])
  }, [])
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    const click = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a[href]')
      if (a && dirtyRef.current && !window.confirm('Discard your unsaved settings?')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', click, true)
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          depth: '0',
          limit: '100',
          sort: 'title',
          'where[_status][equals]': 'published',
        })
        if (pageQuery) params.set('where[title][like]', pageQuery)
        const mediaParams = new URLSearchParams({
          depth: '0',
          limit: '50',
          'where[mimeType][contains]': 'image/',
        })
        if (mediaQuery) mediaParams.set('where[filename][like]', mediaQuery)
        const responses = await Promise.all([
          fetch(`${api}/pages?${params}`, { signal: controller.signal }),
          fetch(`${api}/media?${mediaParams}`, { signal: controller.signal }),
        ])
        if (responses.some((r) => !r.ok))
          throw new Error('Unable to load page or image choices. Try again.')
        const [pages, images] = await Promise.all(
          responses.map((r) => r.json() as Promise<{ docs: Choice[] }>),
        )
        setChoices(pages.docs)
        setMedia(images.docs)
        setLookupError('')
      } catch (e) {
        if (!controller.signal.aborted)
          setLookupError(e instanceof Error ? e.message : 'Unable to load choices.')
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [api, pageQuery, mediaQuery])
  const change = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setMessage('')
  }
  const switchSection = (next: Section) => {
    if (next === section || saving) return
    if (dirty && !window.confirm('Discard your unsaved settings?')) return
    const nextValues = values(next === 'Features' ? system : site, next)
    setSection(next)
    setForm(nextValues)
    setBaseline(JSON.stringify(nextValues))
    setMessage('')
    setError('')
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(
        `${api}/globals/${section === 'Features' ? 'system-settings' : 'site-settings'}?depth=1`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      )
      const result = (await response.json()) as {
        result?: SiteSetting & SystemSetting
        doc?: SiteSetting & SystemSetting
        errors?: Array<{ message?: string; data?: { errors?: Array<{ message: string }> } }>
      }
      if (!response.ok)
        throw new Error(
          result.errors
            ?.map(
              (item: { message?: string; data?: { errors?: Array<{ message: string }> } }) =>
                item.data?.errors?.map((v) => v.message).join(' ') || item.message,
            )
            .join(' ') || 'Settings could not be saved.',
        )
      const doc = result.result || result.doc
      if (!doc)
        throw new Error(
          'The server returned an unexpected save response. Reload to confirm the saved settings.',
        )
      if (section === 'Features') setSystem(doc)
      else setSite(doc)
      const saved = values(doc, section)
      setForm(saved)
      setBaseline(JSON.stringify(saved))
      setMessage(`${section} settings saved.`)
      window.dispatchEvent(new Event('system-settings-saved'))
      await refreshPermissions().catch(() => {})
      router.refresh()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Settings could not be saved. Your changes have been retained.',
      )
    } finally {
      setSaving(false)
    }
  }
  const input = (key: string, label: string, required = false) => (
    <label className="settings-hub__field">
      {label}
      <input
        aria-label={label}
        required={required}
        value={String(form[key] ?? '')}
        onChange={(e) => change(key, e.target.value)}
      />
    </label>
  )
  const toggle = (key: string, label: string, description: string, defaultOn = false) => (
    <div className="settings-hub__toggle">
      <div>
        <strong>{label}</strong>
        <p id={`${key}-description`}>{description}</p>
      </div>
      <label className="system-settings-switch">
        <input
          type="checkbox"
          role="switch"
          aria-label={label}
          aria-describedby={`${key}-description`}
          checked={form[key] == null ? defaultOn : Boolean(form[key])}
          onChange={(e) => change(key, e.target.checked)}
        />
        <span className="system-settings-switch__track" aria-hidden="true" />
        <span>{(form[key] == null ? defaultOn : form[key]) ? 'On' : 'Off'}</span>
      </label>
    </div>
  )
  const pageSelect = (key: string, label: string, fallback: string) => {
    const current = (site as unknown as Record<string, unknown>)[key] as Choice | null
    return (
      <label className="settings-hub__field">
        {label}
        <select
          aria-label={label}
          value={String(form[key] ?? '')}
          onChange={(e) => change(key, e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{fallback}</option>
          {current && typeof current === 'object' && !choices.some((p) => p.id === current.id) && (
            <option value={current.id}>{current.title || 'Current page'}</option>
          )}
          {choices.map((page) => (
            <option key={page.id} value={page.id}>
              {page.title}
            </option>
          ))}
        </select>
      </label>
    )
  }
  const icon =
    media.find((m) => m.id === Number(form.favicon)) ||
    (typeof site.favicon === 'object' ? site.favicon : null)
  const format = {
    timezone: String(form.timezone || 'UTC'),
    dateFormat: String(form.dateFormat || 'long'),
    timeFormat: String(form.timeFormat || '12'),
  }
  let preview = ''
  try {
    preview = `${formatSiteDate('2026-10-17T13:30:00Z', format)} · ${formatSiteTime('2026-10-17T13:30:00Z', format)}`
  } catch {
    preview = 'Choose a valid timezone to see the preview.'
  }
  return (
    <main className="settings-hub">
      <header>
        <p className="settings-hub__eyebrow">VortiPayload+</p>
        <h1>Settings</h1>
        <p>Manage your site’s identity, publishing defaults, and features.</p>
      </header>
      <nav aria-label="Settings sections" className="settings-hub__tabs">
        {sections.map((item) => (
          <button
            type="button"
            key={item}
            aria-current={section === item ? 'page' : undefined}
            onClick={() => switchSection(item)}
            disabled={saving}
          >
            {item}
          </button>
        ))}
      </nav>
      <form onSubmit={save} className="settings-hub__panel" aria-label={`${section} settings`}>
        <h2>{section}</h2>
        <fieldset disabled={saving}>
          {section === 'General' && (
            <>
              {input('siteName', 'Site Title', true)}
              {input('siteTagline', 'Tagline')}
              <div className="settings-hub__field">
                <label htmlFor="icon-search">Find a site icon</label>
                <input
                  id="icon-search"
                  type="search"
                  value={mediaQuery}
                  onChange={(e) => setMediaQuery(e.target.value)}
                  placeholder="Search image filenames"
                />
                <label htmlFor="site-icon">Site Icon</label>
                <select
                  id="site-icon"
                  value={String(form.favicon ?? '')}
                  onChange={(e) =>
                    change('favicon', e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">No icon</option>
                  {typeof site.favicon === 'object' &&
                    site.favicon &&
                    !media.some((m) => m.id === (site.favicon as Choice).id) && (
                      <option value={site.favicon.id}>{site.favicon.filename}</option>
                    )}
                  {media.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.filename}
                    </option>
                  ))}
                </select>
                <small>
                  Choose an image from Media. A square image of at least 512 × 512 pixels is
                  recommended.
                </small>
                {form.favicon && icon?.url ? (
                  <Image
                    unoptimized
                    width={64}
                    height={64}
                    className="settings-hub__icon"
                    src={icon.url}
                    alt="Selected site icon"
                  />
                ) : null}
              </div>
              <label className="settings-hub__field">
                Timezone
                <input
                  aria-label="Timezone"
                  list="settings-timezones"
                  value={String(form.timezone || 'UTC')}
                  onChange={(e) => change('timezone', e.target.value)}
                />
                <datalist id="settings-timezones">
                  {zones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
                <small>
                  Used for public dates and as the default for new schedules. Existing schedules
                  keep their timezone.
                </small>
              </label>
              <div className="settings-hub__columns">
                <label className="settings-hub__field">
                  Date Format
                  <select
                    aria-label="Date Format"
                    value={String(form.dateFormat || 'long')}
                    onChange={(e) => change('dateFormat', e.target.value)}
                  >
                    {dateFormats.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-hub__field">
                  Time Format
                  <select
                    aria-label="Time Format"
                    value={String(form.timeFormat || '12')}
                    onChange={(e) => change('timeFormat', e.target.value)}
                  >
                    {timeFormats.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <output className="settings-hub__preview">Preview: {preview}</output>
            </>
          )}
          {(section === 'Reading' || section === 'Privacy') && (
            <>
              <label className="settings-hub__field">
                Find a published page
                <input
                  type="search"
                  placeholder="Search page titles"
                  value={pageQuery}
                  onChange={(e) => setPageQuery(e.target.value)}
                />
              </label>
              <small>Search to find pages beyond the first 100 results.</small>
            </>
          )}
          {section === 'Reading' && (
            <>
              {pageSelect('homepage', 'Homepage', 'Built-in homepage')}
              {pageSelect('blogPage', 'Posts Page', 'Default /posts listing')}
              {toggle(
                'discourageSearchIndexing',
                'Discourage search engines from indexing this site',
                'Adds a noindex, nofollow request to public pages. Search engines decide whether to honor it. This does not make the site private.',
              )}
            </>
          )}
          {section === 'Privacy' && (
            <>
              {pageSelect('privacyPolicyPage', 'Privacy Policy page', 'No privacy policy selected')}
              {toggle(
                'showPrivacyPolicyLink',
                'Show a Privacy Policy footer link',
                'Adds a link to the selected published page in the site footer.',
              )}
            </>
          )}
          {section === 'Features' && (
            <>
              <table className="system-settings-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Description</th>
                    <th>Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Categories</th>
                    <td>
                      Show category management, selection, filters, and public labels. Disabling
                      preserves existing data and saved listing rules.
                    </td>
                    <td>
                      <label className="system-settings-switch">
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label="Categories"
                          checked={form.categoriesEnabled !== false}
                          onChange={(e) => change('categoriesEnabled', e.target.checked)}
                        />
                        <span className="system-settings-switch__track" aria-hidden="true" />
                        <span>{form.categoriesEnabled !== false ? 'On' : 'Off'}</span>
                      </label>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="settings-hub__roles">
                <h3>Tag management permissions</h3>
                <p>
                  Choose who can create, rename, and delete tags. Other editors can still assign
                  existing tags.
                </p>
                {['administrator', 'designer', 'editor'].map((role) => {
                  const roles = (form.tagManagementRoles || [
                    'administrator',
                    'designer',
                    'editor',
                  ]) as string[]
                  return (
                    <label key={role}>
                      <input
                        type="checkbox"
                        checked={role === 'administrator' || roles.includes(role)}
                        disabled={role === 'administrator'}
                        onChange={(e) =>
                          change('tagManagementRoles', [
                            'administrator',
                            ...roles.filter((r) => r !== role && r !== 'administrator'),
                            ...(e.target.checked ? [role] : []),
                          ])
                        }
                      />
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                      {role === 'administrator' ? ' (always allowed)' : ''}
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </fieldset>
        {lookupError && <p role="alert">{lookupError}</p>}
        {error && (
          <p role="alert" className="settings-hub__error">
            {error}
          </p>
        )}
        <footer className="settings-hub__actions">
          <button type="submit" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <span role="status">{message || (dirty ? 'You have unsaved changes.' : '')}</span>
        </footer>
      </form>
    </main>
  )
}
