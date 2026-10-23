'use client'
import { useEffect, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import {
  websiteSettingSections,
  websiteReferences,
  websiteBooleans,
  websiteSettingLabels,
} from './website-fields'

export function WebsiteSettingsEditor({
  site,
  revision,
  presentation,
  onSaved,
  onDirtyChange,
}: {
  site: string
  revision: number
  presentation: string
  onSaved: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const { config } = useConfig()
  const [section, setSection] = useState<keyof typeof websiteSettingSections>('General')
  const [values, setValues] = useState<Record<string, unknown>>(() => JSON.parse(presentation))
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  const [choices, setChoices] = useState<Record<string, Array<{ id: number; label: string }>>>({})
  useEffect(() => {
    let cancelled = false
    void fetch(
      `${config.routes.api}/organization-admin?site=${encodeURIComponent(site)}&websiteChoices=1`,
      { cache: 'no-store' },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Cannot load this site’s page, media, and template choices.')
        const data = (await response.json()) as typeof choices
        if (!cancelled) setChoices(data)
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [config.routes.api, site])
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [dirty])
  async function save() {
    setBusy(true)
    setMessage('')
    try {
      const allowed = new Set<string>(Object.values(websiteSettingSections).flat())
      const settings = Object.fromEntries(
        Object.entries(values).filter(([key]) => allowed.has(key)),
      )
      const response = await fetch(config.routes.api + '/organization-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'website-settings',
          site,
          settings,
          expectedRevision: revision,
          operationKey: crypto.randomUUID(),
        }),
      })
      const data = (await response.json()) as { message?: string }
      if (!response.ok)
        throw new Error(data.message || 'Save failed. Your input has been retained.')
      setDirty(false)
      setMessage('Website settings saved.')
      onSaved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save. Your input is retained.')
    } finally {
      setBusy(false)
    }
  }
  const label = (name: string) =>
    websiteSettingLabels[name] ||
    name.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
  return (
    <section aria-label="Child website settings">
      <h3>Website settings</h3>
      <nav aria-label="Child website settings sections">
        {Object.keys(websiteSettingSections).map((name) => (
          <button
            type="button"
            key={name}
            aria-current={section === name ? 'page' : undefined}
            onClick={() => setSection(name as typeof section)}
          >
            {name}
          </button>
        ))}
      </nav>
      {websiteSettingSections[section].map((name) => (
        <label key={name}>
          {label(name)}
          {websiteBooleans.has(name) ? (
            <input
              type="checkbox"
              checked={!!values[name]}
              disabled={busy}
              onChange={(event) => {
                setValues({ ...values, [name]: event.target.checked })
                setDirty(true)
              }}
            />
          ) : websiteReferences[name] ? (
            <select
              value={String(values[name] || '')}
              disabled={busy}
              onChange={(event) => {
                setValues({
                  ...values,
                  [name]: event.target.value ? Number(event.target.value) : null,
                })
                setDirty(true)
              }}
            >
              <option value="">None</option>
              {(choices[websiteReferences[name]] || []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={String(values[name] || '')}
              disabled={busy}
              maxLength={5000}
              onChange={(event) => {
                setValues({ ...values, [name]: event.target.value })
                setDirty(true)
              }}
            />
          )}
        </label>
      ))}
      <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save website settings'}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
