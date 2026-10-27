'use client'
import { useEffect, useRef, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import { permissions, type Permission } from '../organizations/permission-catalog'
import './system-settings.css'
import { TenantMemberships } from './TenantMemberships'
import { WebsiteControls } from '../organizations/WebsiteControls'

const sections = ['General', 'Reading', 'Privacy', 'Features', 'Roles'] as const
type Section = (typeof sections)[number]
type Role = {
  id: string
  name: string
  description: string
  builtin: string | null
  retired: number
  permissions: Permission[]
}
type Feature = {
  feature: string
  tenantAvailable: boolean
  available: boolean
  configured: string
  controllingScope: string
  locked: boolean
}
type Choice = { id: number; title?: string; filename?: string }
type SettingsResponse = {
  message?: string
  revision: number
  roles: Role[]
  features: Feature[]
  settings: Record<string, unknown>
}
export function TenantSettingsHub({
  site,
  section: requested,
  initial,
  initialRevision,
  tenantAdministrator,
}: {
  site: string
  section: string
  initial: Record<string, unknown>
  initialRevision: number
  tenantAdministrator: boolean
}) {
  const section: Section =
    sections.find((item) => item.toLowerCase() === requested.toLowerCase()) || 'General'
  const { config } = useConfig()
  const api = config.routes.api
  const [form, setForm] = useState(initial),
    [baseline, setBaseline] = useState(JSON.stringify(initial))
  const [revision, setRevision] = useState(initialRevision),
    [authorityRevision, setAuthorityRevision] = useState(0)
  const [roles, setRoles] = useState<Role[]>([]),
    [features, setFeatures] = useState<Feature[]>([])
  const [role, setRole] = useState<Role | null>(null),
    [roleBaseline, setRoleBaseline] = useState('')
  const [pages, setPages] = useState<Choice[]>([]),
    [media, setMedia] = useState<Choice[]>([])
  const [query, setQuery] = useState(''),
    [choiceMessage, setChoiceMessage] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const [origins, setOrigins] = useState(''),
    [savedOrigins, setSavedOrigins] = useState(''),
    [tenantRevision, setTenantRevision] = useState<number | null>(null)
  const [websiteDirty, setWebsiteDirty] = useState(false)
  const dirty = websiteDirty ||
    JSON.stringify(form) !== baseline ||
    (!!role && JSON.stringify(role) !== roleBaseline) ||
    origins !== savedOrigins
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    if (!tenantAdministrator || section !== 'General') return
    const controller = new AbortController()
    fetch(`${api}/tenant-settings?site=${encodeURIComponent(site)}&section=tenant`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error('Tenant settings could not be loaded.')
        return response.json() as Promise<SettingsResponse>
      })
      .then((value) => {
        const text = (value.settings.workspaceEmbedOrigins as string[]).join('\n')
        setOrigins(text)
        setSavedOrigins(text)
        setTenantRevision(value.revision)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message)
      })
    return () => controller.abort()
  }, [api, site, section, tenantAdministrator])
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const click = (event: MouseEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('a[href]') ||
        !dirtyRef.current
      )
        return
      if (!window.confirm('Discard your unsaved settings?')) {
        event.preventDefault()
        event.stopPropagation()
      } else dirtyRef.current = false
    }
    window.addEventListener('beforeunload', leave)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', leave)
      document.removeEventListener('click', click, true)
    }
  }, [])
  useEffect(() => {
    if (section !== 'Roles' && section !== 'Features') return
    const controller = new AbortController()
    fetch(
      `${api}/tenant-settings?site=${encodeURIComponent(site)}&section=${section.toLowerCase()}`,
      { signal: controller.signal, cache: 'no-store' },
    )
      .then(async (response) => {
        const value = (await response.json()) as SettingsResponse
        if (!response.ok) throw Error(value.message || 'Settings could not be loaded.')
        return value
      })
      .then((value) => {
        setAuthorityRevision(value.revision)
        setRoles(value.roles || [])
        setFeatures(value.features || [])
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message)
      })
    return () => controller.abort()
  }, [api, site, section])
  useEffect(() => {
    if (!['General', 'Reading', 'Privacy'].includes(section)) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const collection = section === 'General' ? 'media' : 'pages'
        const params = new URLSearchParams({ depth: '0', limit: '100' })
        if (collection === 'pages') {
          params.set('where[_status][equals]', 'published')
          if (query) params.set('where[title][like]', query)
        } else {
          params.set('where[mimeType][contains]', 'image/')
          if (query) params.set('where[filename][like]', query)
        }
        const response = await fetch(`${api}/${collection}?${params}`, {
          headers: { 'x-vorticause-site': site },
          signal: controller.signal,
        })
        if (!response.ok) throw Error('Choices are unavailable. Existing selections are retained.')
        const value = (await response.json()) as { docs: Choice[] }
        if (collection === 'pages') setPages(value.docs)
        else setMedia(value.docs)
        setChoiceMessage('')
      } catch (cause) {
        if (!controller.signal.aborted)
          setChoiceMessage(cause instanceof Error ? cause.message : 'Choices could not be loaded.')
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [api, site, section, query])
  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`${api}/tenant-settings`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, site, operationKey: crypto.randomUUID() }),
      })
      const value = (await response.json()) as SettingsResponse
      if (!response.ok)
        throw Error(
          response.status === 409
            ? 'These settings changed elsewhere. Reload and review before saving. Your draft is retained.'
            : value.message || 'Changes could not be saved.',
        )
      return value
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Changes could not be saved.')
      return null
    } finally {
      setBusy(false)
    }
  }
  const refresh = async (target: 'roles' | 'features') => {
    const response = await fetch(
      `${api}/tenant-settings?site=${encodeURIComponent(site)}&section=${target}`,
      { cache: 'no-store' },
    )
    if (!response.ok) {
      setError(
        'Saved, but the refreshed settings could not be loaded. Reload before another change.',
      )
      return
    }
    const value = (await response.json()) as SettingsResponse
    setAuthorityRevision(value.revision)
    if (target === 'roles') setRoles(value.roles)
    else setFeatures(value.features)
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const result = await post({
      action: 'settings',
      scope: 'site',
      settings: form,
      expectedRevision: revision,
    })
    if (result) {
      setForm(result.settings)
      setBaseline(JSON.stringify(result.settings))
      setRevision(result.revision)
      setMessage('Settings saved.')
      window.dispatchEvent(new Event('system-settings-saved'))
    }
  }
  const change = (key: string, value: unknown) => {
    setForm((previous) => ({ ...previous, [key]: value }))
    setMessage('')
  }
  const text = (key: string, label: string, required = false) => (
    <label className="settings-hub__field">
      {label}
      <input
        required={required}
        value={String(form[key] ?? '')}
        onChange={(event) => change(key, event.target.value)}
      />
    </label>
  )
  const toggle = (key: string, label: string) => (
    <label className="settings-hub__toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={Boolean(form[key])}
        onChange={(event) => change(key, event.target.checked)}
      />
    </label>
  )
  const select = (key: string, label: string, choices: Choice[]) => (
    <label className="settings-hub__field">
      {label}
      <select
        value={String(form[key] ?? '')}
        onChange={(event) => change(key, event.target.value ? Number(event.target.value) : null)}
      >
        <option value="">None</option>
        {form[key] && !choices.some((choice) => choice.id === form[key]) ? (
          <option value={String(form[key])}>Saved selection (#{String(form[key])})</option>
        ) : null}
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.title || choice.filename || `#${choice.id}`}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <main className="settings-hub settings-hub--scoped">
      <header>
        <h1>Settings</h1>
        <p>{site === 'default' ? 'Primary site' : `Site: ${site}`}</p>
      </header>
      <div className="settings-hub__workspace">
        <nav aria-label="Settings sections" className="settings-hub__sidebar">
          {sections.map((item) => (
            <a
              key={item}
              aria-current={section === item ? 'page' : undefined}
              href={`?site=${encodeURIComponent(site)}&section=${item.toLowerCase()}`}
            >
              {item}
            </a>
          ))}
        </nav>
        <section className="settings-hub__panel" aria-label={`${section} settings`}>
          <h2>{section}</h2>
          {['General', 'Reading', 'Privacy'].includes(section) && (
            <form onSubmit={save}>
              <fieldset disabled={busy}>
                {section === 'General' && (
                  <>
                    {text('siteName', 'Site name', true)}
                    {text('siteTagline', 'Tagline')}
                    {text('timezone', 'Timezone', true)}
                    <div className="settings-hub__columns">
                      <label className="settings-hub__field">
                        Date format
                        <select
                          value={String(form.dateFormat)}
                          onChange={(event) => change('dateFormat', event.target.value)}
                        >
                          {['long', 'short', 'iso', 'us', 'day-first'].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label className="settings-hub__field">
                        Time format
                        <select
                          value={String(form.timeFormat)}
                          onChange={(event) => change('timeFormat', event.target.value)}
                        >
                          <option value="12">12 hour</option>
                          <option value="24">24 hour</option>
                        </select>
                      </label>
                    </div>
                    {select('favicon', 'Site icon', media)}
                  </>
                )}
                {section !== 'General' && (
                  <label className="settings-hub__field">
                    Find a published page
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                )}
                {section === 'Reading' && (
                  <>
                    {select('homepage', 'Homepage', pages)}
                    {select('blogPage', 'Posts page', pages)}
                    {toggle('discourageSearchIndexing', 'Discourage search engine indexing')}
                    <p>This requests noindex; it does not make content private.</p>
                  </>
                )}
                {section === 'Privacy' && (
                  <>
                    {select('privacyPolicyPage', 'Privacy policy page', pages)}
                    {toggle('showPrivacyPolicyLink', 'Show the privacy policy footer link')}
                    <p>
                      Tenant Administrators can read all content in their tenant, including personal
                      Tasks and restricted records. This access is audited.
                    </p>
                  </>
                )}
                {choiceMessage && <p role="status">{choiceMessage}</p>}
                <footer className="settings-hub__actions">
                  <button disabled={busy || !dirty} type="submit">
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                </footer>
              </fieldset>
            </form>
          )}
          {section === 'Reading' && <WebsiteControls site={site} onDirtyChange={setWebsiteDirty} />}
          {section === 'General' && tenantAdministrator && tenantRevision !== null && (
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                const result = await post({
                  action: 'settings',
                  scope: 'tenant',
                  settings: {
                    workspaceEmbedOrigins: origins
                      .split(/\r?\n/)
                      .map((value) => value.trim())
                      .filter(Boolean),
                  },
                  expectedRevision: tenantRevision,
                })
                if (result) {
                  const value = (result.settings.workspaceEmbedOrigins as string[]).join('\n')
                  setOrigins(value)
                  setSavedOrigins(value)
                  setTenantRevision(result.revision)
                  setMessage('Tenant embed origins saved.')
                }
              }}
            >
              <h3>Tenant settings</h3>
              <p>These settings apply to every site in this tenant.</p>
              <label className="settings-hub__field">
                Workspace embed origins (one HTTPS origin per line)
                <textarea
                  value={origins}
                  onChange={(event) => setOrigins(event.target.value)}
                  disabled={busy}
                  rows={4}
                />
              </label>
              <button type="submit" disabled={busy || origins === savedOrigins}>
                Save tenant settings
              </button>
            </form>
          )}
          {section === 'Features' && (
            <>
              <p>
                Disabling a feature preserves its data. Tenant availability limits site overrides.
              </p>
              <table className="system-settings-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Site setting</th>
                    <th>Effective availability</th>
                    {tenantAdministrator && <th>Tenant availability</th>}
                  </tr>
                </thead>
                <tbody>
                  {features.map((feature) => (
                    <tr key={feature.feature}>
                      <th scope="row">{feature.feature}</th>
                      <td>
                        <select
                          aria-label={`${feature.feature} site setting`}
                          disabled={busy || feature.locked}
                          value={feature.configured}
                          onChange={async (event) => {
                            if (
                              await post({
                                action: 'feature',
                                feature: feature.feature,
                                featureSite: site,
                                value: event.target.value,
                                expectedRevision: authorityRevision,
                              })
                            )
                              await refresh('features')
                          }}
                        >
                          <option value="inherit">Inherit</option>
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                        {feature.locked && <p>Disabled by the tenant. A site cannot enable it.</p>}
                      </td>
                      <td>
                        {feature.available ? 'Enabled' : 'Disabled'}
                        <br />
                        Controlled by {feature.controllingScope}
                      </td>
                      {tenantAdministrator && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${feature.feature} tenant availability`}
                            checked={feature.tenantAvailable}
                            disabled={busy}
                            onChange={async (event) => {
                              if (
                                await post({
                                  action: 'feature',
                                  feature: feature.feature,
                                  featureSite: null,
                                  value: event.target.checked,
                                  expectedRevision: authorityRevision,
                                })
                              )
                                await refresh('features')
                            }}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <form onSubmit={save}>
                {toggle('categoriesEnabled', 'Enable Categories')}
                <p>Tag management is controlled by the scoped Tags permission under Roles.</p>
                <button type="submit" disabled={busy || !dirty}>
                  Save Categories setting
                </button>
              </form>
            </>
          )}
          {section === 'Roles' && (
            <>
              <p>
                Built-in roles are read-only. Copying permissions does not grant Tenant
                Administrator private-content access.
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  if (dirty && !window.confirm('Discard your unsaved role changes?')) return
                  const next: Role = {
                    id: crypto.randomUUID(),
                    name: '',
                    description: '',
                    builtin: null,
                    retired: 0,
                    permissions: [],
                  }
                  setRole(next)
                  setRoleBaseline(JSON.stringify(next))
                }}
              >
                Create role
              </button>
              <ul>
                {roles.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (dirty && !window.confirm('Discard your unsaved role changes?')) return
                        setRole(item)
                        setRoleBaseline(JSON.stringify(item))
                      }}
                    >
                      {item.name}
                    </button>{' '}
                    — {item.builtin ? 'Built-in' : 'Custom'}
                    {item.retired ? ' · Retired' : ''}
                    <p>{item.description}</p>
                  </li>
                ))}
              </ul>
              {role && (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault()
                    const result = await post({
                      action: 'role-save',
                      id: role.id,
                      name: role.name,
                      description: role.description,
                      permissions: role.permissions,
                      expectedRevision: authorityRevision,
                    })
                    if (result) {
                      setRoleBaseline(JSON.stringify(role))
                      setMessage('Role saved.')
                      await refresh('roles')
                    }
                  }}
                >
                  <fieldset disabled={busy || !!role.builtin || !!role.retired}>
                    <label className="settings-hub__field">
                      Role name
                      <input
                        required
                        maxLength={120}
                        value={role.name}
                        onChange={(event) => setRole({ ...role, name: event.target.value })}
                      />
                    </label>
                    <label className="settings-hub__field">
                      Description
                      <textarea
                        maxLength={2000}
                        value={role.description}
                        onChange={(event) => setRole({ ...role, description: event.target.value })}
                      />
                    </label>
                    <table className="system-settings-table">
                      <thead>
                        <tr>
                          <th>Resource / action</th>
                          <th>Allowed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {permissions.map((permission) => (
                          <tr key={permission}>
                            <th scope="row">
                              {permission.replace(':', ' / ').replaceAll('-', ' ')}
                            </th>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={permission}
                                checked={role.permissions.includes(permission)}
                                onChange={(event) =>
                                  setRole({
                                    ...role,
                                    permissions: event.target.checked
                                      ? [...role.permissions, permission]
                                      : role.permissions.filter((value) => value !== permission),
                                  })
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <footer className="settings-hub__actions">
                      <button type="submit" disabled={!dirty}>
                        Save role
                      </button>
                      <button
                        type="button"
                        disabled={!roles.some((item) => item.id === role.id)}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              'Retire this role? Its assignments immediately lose these grants.',
                            )
                          )
                            return
                          if (
                            await post({
                              action: 'role-retire',
                              id: role.id,
                              expectedRevision: authorityRevision,
                            })
                          ) {
                            setRole(null)
                            setRoleBaseline('')
                            await refresh('roles')
                            setMessage('Role retired.')
                          }
                        }}
                      >
                        Retire role
                      </button>
                    </footer>
                  </fieldset>
                </form>
              )}
              <TenantMemberships api={api} site={site} roles={roles} />
            </>
          )}
          {error && (
            <p role="alert" className="settings-hub__error">
              {error}
            </p>
          )}
          <p role="status">{message || (dirty ? 'You have unsaved changes.' : '')}</p>
        </section>
      </div>
    </main>
  )
}
