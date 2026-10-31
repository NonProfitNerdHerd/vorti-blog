import { getSafeRedirect } from 'payload/shared'

const returnPathKey = 'vorti-admin-return-path'

export function rememberReturnPath(admin: string, current: string): void {
  const path = current.split(/[?#]/, 1)[0]
  if (!path.startsWith(`${admin.replace(/\/$/, '')}/`) && path !== admin) return
  try { window.sessionStorage.setItem(returnPathKey, current) } catch { /* Storage can be disabled. */ }
}

/** Payload's inactivity redirect omits the query string. Restore it before the login form submits. */
export function restoreInactivityReturn(admin: string): void {
  const url = new URL(window.location.href)
  const redirect = url.searchParams.get('redirect')
  if (!redirect || redirect.includes('?')) return
  let remembered: string | null = null
  try { remembered = window.sessionStorage.getItem(returnPathKey) } catch { return }
  if (!remembered) return
  const safe = getSafeRedirect({ fallbackTo: admin, redirectTo: remembered })
  if (safe.split(/[?#]/, 1)[0] !== redirect || safe === redirect) return
  url.searchParams.set('redirect', safe)
  window.location.replace(`${url.pathname}${url.search}${url.hash}`)
}

/** Payload's login form consumes the same safe, relative redirect path. */
export function loginReturnURL(admin: string, login: string, current: string): string {
  const fallback = admin.replace(/\/$/, '') || '/admin'
  const destination = getSafeRedirect({ fallbackTo: fallback, redirectTo: current })
  const url = new URL(`${fallback}${login.startsWith('/') ? login : `/${login}`}`, 'https://admin.local')
  url.searchParams.set('redirect', destination)
  return `${url.pathname}${url.search}`
}

export function redirectToLogin(admin: string, login: string): void {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const loginPath = `${admin.replace(/\/$/, '')}${login.startsWith('/') ? login : `/${login}`}`
  if (window.location.pathname === loginPath) return
  rememberReturnPath(admin, current)
  window.location.replace(loginReturnURL(admin, login, current))
}
