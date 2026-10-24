'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Resolve and validate the page's explicit site before mounting request-producing views. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth, useConfig } from '@payloadcms/ui'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { hasUnsavedSiteChanges, siteLabel, type AdminSite } from './admin-site'
import './admin-site.css'

type Binding = { site: AdminSite; sites: AdminSite[]; revision: number }
type SiteContext = {
  binding: Binding | null
  switchSite: (site: string) => void
  busy: boolean
  error: string
}
const Context = createContext<SiteContext>({
  binding: null,
  switchSite: () => {},
  busy: false,
  error: '',
})
export const useAdminSite = () => useContext(Context)

export function AdminSiteProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth(),
    { config } = useConfig(),
    params = useSearchParams(),
    router = useRouter()
  const userID = user?.id
  const requested = params.get('site'),
    api = config.routes.api,
    admin = config.routes.admin
  const [binding, setBinding] = useState<Binding | null>(null),
    [error, setError] = useState('')
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<string | null>(null)
  const [ready, setReady] = useState(false),
    [retry, setRetry] = useState(0)
  const current = useRef<Binding | null>(null),
    confirm = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!userID) return
    let live = true
    setReady(false)
    setError('')
    async function load() {
      const sites: AdminSite[] = []
      let after: string | null = '',
        context = { site: 'default', revision: 0 }
      do {
        const response = await fetch(
          `${api}/organization-admin${after ? '?after=' + encodeURIComponent(after) : ''}`,
          {
            cache: 'no-store',
            headers: requested ? { 'x-vorticause-site': requested } : undefined,
          },
        )
        if (!response.ok) throw new Error('Could not load your sites. Retry to check access.')
        const data = (await response.json()) as {
          sites: AdminSite[]
          next: string | null
          context: typeof context
        }
        sites.push(...data.sites.filter((site) => !site.archived))
        after = data.next
        context = data.context
      } while (after)
      const selected = requested || context.site,
        site = sites.find((item) => item.id === selected)
      if (!site) throw new Error('This site is unavailable. Your page has not been switched.')
      if (!live) return
      const next = { site, sites, revision: context.revision }
      current.current = next
      setBinding(next)
      if (!requested) {
        const url = new URL(window.location.href)
        url.searchParams.set('site', selected)
        window.history.replaceState(window.history.state, '', url)
      }
      setReady(true)
    }
    void load().catch((cause) => {
      if (live) setError(cause.message)
    })
    return () => {
      live = false
    }
  }, [api, userID, requested, retry])
  useEffect(() => {
    if (!userID) return
    const original = window.fetch
    const scoped: typeof fetch = (input, init) => {
      const selected = current.current?.site.id
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      )
      if (
        !selected ||
        url.origin !== window.location.origin ||
        !(url.pathname === api || url.pathname.startsWith(api + '/'))
      )
        return original(input, init)
      const headers = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined),
      )
      if (!headers.has('x-vorticause-site')) headers.set('x-vorticause-site', selected)
      return original(input, { ...init, headers })
    }
    window.fetch = scoped
    return () => {
      if (window.fetch === scoped) window.fetch = original
    }
  }, [api, admin, userID])
  async function apply(site: string) {
    if (!current.current || busy) return
    setBusy(true)
    setError('')
    try {
      // Refresh the preference revision; another tab may have changed it. This
      // does not change this page's bound site or weaken the commit-time guard.
      const check = await fetch(`${api}/organization-admin`, {
        cache: 'no-store',
        headers: { 'x-vorticause-site': site },
      })
      if (!check.ok) throw new Error('Could not validate the site switch.')
      const data = (await check.json()) as { context: { revision: number } }
      const response = await fetch(`${api}/organization-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vorticause-site': site },
        body: JSON.stringify({
          action: 'context',
          site,
          expectedRevision: data.context.revision,
          operationKey: crypto.randomUUID(),
        }),
      })
      if (!response.ok)
        throw new Error(
          'Could not switch sites. Your access or site preference changed; please retry.',
        )
      router.push(`${admin}?site=${encodeURIComponent(site)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not switch sites.')
    } finally {
      setBusy(false)
    }
  }
  function switchSite(site: string) {
    if (busy || site === binding?.site.id) return
    if (hasUnsavedSiteChanges()) {
      setPending(site)
      confirm.current?.showModal()
    } else void apply(site)
  }
  if (!user) return children
  const matches = binding && (!requested || binding.site.id === requested)
  return (
    <Context.Provider value={{ binding: matches ? binding : null, switchSite, busy, error }}>
      {ready && matches ? (
        children
      ) : (
        <main role="status" className="vc-site-loading">
          {error || 'Loading site…'}
          {error && <button onClick={() => setRetry((value) => value + 1)}>Retry</button>}
        </main>
      )}
      {ready && matches && error && (
        <div role="alert" className="vc-site-error">
          {error}
        </div>
      )}
      <dialog ref={confirm} className="vc-site-confirm" onCancel={() => setPending(null)}>
        <h2>Switch site?</h2>
        <p>Your unsaved changes will be discarded. Open the selected site’s dashboard?</p>
        <button
          type="button"
          onClick={() => {
            confirm.current?.close()
            setPending(null)
          }}
        >
          Stay on this page
        </button>
        <button
          type="button"
          onClick={() => {
            confirm.current?.close()
            if (pending) void apply(pending)
            setPending(null)
          }}
        >
          Switch site
        </button>
      </dialog>
    </Context.Provider>
  )
}

export function AdminSiteSwitcher() {
  const { binding, switchSite, busy } = useAdminSite()
  const path = usePathname()
  if (!binding) return null
  const { site, sites } = binding
  return (
    <div className="vc-site-tab">
      {path.endsWith('/globals/system-settings') && (
        <span className="vc-site-installation">Installation-wide settings</span>
      )}
      {sites.length === 1 ? (
        <span aria-label="Current site">{site.name}</span>
      ) : (
        <label>
          <span className="vc-site-sr">Current site</span>
          <select
            aria-label="Current site"
            value={site.id}
            disabled={busy}
            onChange={(event) => switchSite(event.target.value)}
          >
            {sites.map((item) => (
              <option key={item.id} value={item.id}>
                {siteLabel(item, sites)}
              </option>
            ))}
          </select>
        </label>
      )}
      {busy && (
        <span role="status" className="vc-site-sr">
          Switching site…
        </span>
      )}
    </div>
  )
}
