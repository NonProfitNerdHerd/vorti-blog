'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Load the explicit chapter configuration. */
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { EmailSettings as Settings } from './email-model'
type Configuration = {
  values: Settings
  revision: number
  verified: boolean
  verifiedAt: string | null
  credentialsConfigured: boolean
  liveEnvironmentEnabled: boolean
  ready: boolean
}
type Props = {
  api: string
  site: string
  onDirty?: (value: boolean) => void
  onSaving?: (value: boolean) => void
}
export function EmailSettings(props: Props) {
  return <ConfigurationEditor key={`${props.api}:${props.site}`} {...props} />
}
function ConfigurationEditor({ api, site, onDirty, onSaving }: Props) {
  const [data, setData] = useState<Configuration | null>(null),
    [values, setValues] = useState<Settings>({
      provider: 'disabled',
      senderEmail: '',
      senderName: '',
      replyTo: '',
      domainID: '',
      enabled: false,
    }),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [denied, setDenied] = useState(false),
    [refresh, setRefresh] = useState(0)
  const operation = useRef<{ intent: string; key: string } | null>(null)
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    onSaving?.(busy || loading)
  }, [busy, loading, onSaving])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void crmRead<Configuration>(`${api}/crm/email-settings?${new URLSearchParams({ site })}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setValues(result.values)
        setDirty(false)
        setError('')
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setData(null)
          setError(cause.message)
          if ([401, 403].includes(cause.status)) {
            setDenied(true)
            setDirty(false)
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [api, site, refresh])
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
  const change = (patch: Partial<Settings>) => {
    setValues((current) => ({ ...current, enabled: false, ...patch }))
    setDirty(true)
    operation.current = null
  }
  const save = async (action: 'save-settings' | 'verify-settings') => {
    if (!data || busy || loading) return
    const body = {
        site,
        action,
        expectedRevision: data.revision,
        ...(action === 'save-settings' ? { values } : {}),
      },
      intent = JSON.stringify(body)
    if (operation.current?.intent !== intent)
      operation.current = { intent, key: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      await crmRead(`${api}/crm/email-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationKey: operation.current.key }),
      })
      operation.current = null
      setDirty(false)
      setLoading(true)
      setRefresh((value) => value + 1)
    } catch (cause) {
      setError((cause as Error).message)
      if ([401, 403].includes((cause as { status: number }).status)) {
        setDenied(true)
        setData(null)
        setDirty(false)
      }
    } finally {
      setBusy(false)
    }
  }
  if (denied)
    return (
      <section aria-label="Email configuration">
        <p role="alert">{error}</p>
      </section>
    )
  return (
    <section className="vc-crm-domain" aria-label="Email configuration">
      <h2>Email configuration</h2>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading chapter email settings…</p>}
      {data && (
        <>
          <p role="status">
            {data.ready
              ? 'Email delivery is configured and enabled.'
              : 'Email delivery is unconfigured or disabled. Preview, print and PDF remain available.'}
          </p>
          <p>
            {data.credentialsConfigured
              ? 'Provider credentials are configured.'
              : 'An installation operator must configure provider credentials.'}{' '}
            {data.liveEnvironmentEnabled
              ? 'Production sending is enabled for this environment.'
              : 'Live sending is disabled for this environment.'}
          </p>
          <p>
            {data.verified
              ? `Sender domain verified at ${data.verifiedAt}.`
              : 'The sender domain requires verification before delivery can be enabled.'}
          </p>
          <fieldset disabled={busy || loading}>
            <label>
              Email provider
              <select
                value={values.provider}
                onChange={(event) =>
                  change({ provider: event.target.value as Settings['provider'] })
                }
              >
                <option value="disabled">Disabled</option>
                <option value="resend">Resend</option>
              </select>
            </label>
            <label>
              Sender email
              <input
                type="email"
                value={values.senderEmail}
                maxLength={254}
                onChange={(event) => change({ senderEmail: event.target.value })}
              />
            </label>
            <label>
              Sender name
              <input
                value={values.senderName}
                maxLength={120}
                onChange={(event) => change({ senderName: event.target.value })}
              />
            </label>
            <label>
              Reply-to email
              <input
                type="email"
                value={values.replyTo}
                maxLength={254}
                onChange={(event) => change({ replyTo: event.target.value })}
              />
            </label>
            <label>
              Provider domain ID
              <input
                value={values.domainID}
                maxLength={36}
                onChange={(event) => change({ domainID: event.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={values.enabled}
                onChange={(event) => change({ enabled: event.target.checked })}
              />{' '}
              Enable chapter email delivery
            </label>
            <button type="button" disabled={!dirty} onClick={() => void save('save-settings')}>
              Save email settings
            </button>
            <button
              type="button"
              disabled={
                dirty ||
                !data.revision ||
                !data.credentialsConfigured ||
                values.provider !== 'resend'
              }
              onClick={() => void save('verify-settings')}
            >
              Verify sender domain
            </button>
          </fieldset>
        </>
      )}
    </section>
  )
}
