'use client'
import { useEffect, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import { WebsiteSettingsEditor } from './WebsiteSettingsEditor'
import type { websiteStatus } from './websites'

type Status = Awaited<ReturnType<typeof websiteStatus>>
export function WebsiteControls({
  site,
  onDirtyChange,
  descendantNames = [],
}: {
  site: string
  onDirtyChange: (dirty: boolean) => void
  descendantNames?: string[]
}) {
  const { config } = useConfig()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  useEffect(() => {
    onDirtyChange(editorDirty)
  }, [editorDirty, onDirtyChange])
  const api = config.routes.api + '/organization-admin'
  useEffect(() => {
    let cancelled = false
    void fetch(`${api}?site=${encodeURIComponent(site)}&website=1`, { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as { message?: string }
        if (!response.ok) throw new Error(data.message || 'Website unavailable.')
        return data as Status
      })
      .then((data) => {
        if (!cancelled) setStatus(data)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause.message)
      })
    return () => {
      cancelled = true
    }
  }, [api, site])
  async function change(
    action: 'subsites' | 'publication' | 'initialize-website',
    enabled: boolean,
  ) {
    if (!status || busy) return
    if (
      action === 'subsites' &&
      !enabled &&
      status.descendants &&
      !window.confirm(
        `Pause ${status.descendants} descendant websites? Content is preserved. Authorized maintenance remains available.`,
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          site,
          enabled,
          expectedRevision: status.revision,
          confirmedDescendants: status.descendants,
          operationKey: crypto.randomUUID(),
        }),
      })
      const data = (await response.json()) as { message?: string }
      if (!response.ok)
        throw new Error(data.message || 'Save failed. Reload the current website status.')
      const refreshed = await fetch(`${api}?site=${encodeURIComponent(site)}&website=1`, {
        cache: 'no-store',
      })
      if (!refreshed.ok) throw new Error('Saved. Reload to review current website status.')
      setStatus(await refreshed.json())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save.')
    } finally {
      setBusy(false)
    }
  }
  async function openEditor() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(api, { cache: 'no-store' })
      if (!response.ok) throw new Error('Cannot load site context.')
      const current = (await response.json()) as { context: { revision: number } }
      const saved = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'context',
          site,
          expectedRevision: current.context.revision,
          operationKey: crypto.randomUUID(),
        }),
      })
      if (!saved.ok) throw new Error('Site context changed. Reload before opening the editor.')
      window.location.assign(config.routes.admin + '/collections/pages')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open editor.')
      setBusy(false)
    }
  }
  return (
    <section aria-label="Website availability">
      <h3>Website and SubSites</h3>
      {error && <p role="alert">{error}</p>}
      {status && (
        <>
          {status.controller && (
            <p>
              SubSites disabled by {status.controller.name}. Descendant overrides cannot enable it.
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={!!status.subsites_enabled}
              disabled={busy || editorDirty || (!!status.controller && !status.subsites_enabled)}
              onChange={(event) => void change('subsites', event.target.checked)}
            />
            Enable SubSites
          </label>
          <p>
            {status.descendants} descendant sites. Turning this off pauses their public websites and
            prevents creation and publication below this site.
          </p>
          {status.descendants > 0 && (
            <details>
              <summary>Affected descendants ({status.descendants})</summary>
              <ul>
                {descendantNames.map((name, index) => (
                  <li key={index}>{name}</li>
                ))}
              </ul>
              {status.descendants > descendantNames.length && (
                <p>
                  {status.descendants - descendantNames.length} further descendants are outside the
                  currently loaded, authorized site list.
                </p>
              )}
            </details>
          )}
          {(
            <>
              {site !== 'default' && !status.initialized && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void change('initialize-website', false)}
                >
                  Initialize website from parent design
                </button>
              )}
              {site !== 'default' && status.initialized && (
                <WebsiteSettingsEditor
                  site={site}
                  revision={status.settingsRevision ?? status.revision}
                  presentation={JSON.stringify({
                    ...JSON.parse(status.presentation),
                    ...JSON.parse(status.navigation),
                  })}
                  onDirtyChange={setEditorDirty}
                  onSaved={() => {
                    setBusy(true)
                    void fetch(`${api}?site=${encodeURIComponent(site)}&website=1`, {
                      cache: 'no-store',
                    })
                      .then((response) => response.json())
                      .then((value) => setStatus(value as Status))
                      .catch(() =>
                        setError('Settings saved. Reload to review the current website revision.'),
                      )
                      .finally(() => setBusy(false))
                  }}
                />
              )}
              <button
                type="button"
                disabled={busy || editorDirty}
                onClick={() => void openEditor()}
              >
                Open site editor
              </button>
              {status.initialized && (
                <a href={`${site === 'default' ? '/' : `/sites/${status.route_key}`}?preview=1`} target="_blank" rel="noreferrer">
                  Preview website
                </a>
              )}
              <p>
                Website:{' '}
                {status.published
                  ? status.controller
                    ? 'Paused by ancestor'
                    : 'Published'
                  : 'Unpublished'}
              </p>
              <button
                type="button"
                disabled={
                  busy ||
                  editorDirty ||
                  (!!status.controller && !status.published) ||
                  !status.initialized
                }
                onClick={() => void change('publication', !status.published)}
              >
                {status.published ? 'Unpublish website' : 'Publish website'}
              </button>
              {status.published && !status.controller && (
                <a href={site === 'default' ? '/' : `/sites/${status.route_key}`} target="_blank" rel="noreferrer">
                  View website
                </a>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
