import { afterEach, describe, expect, it, vi } from 'vitest'
import { loginReturnURL, rememberReturnPath, restoreInactivityReturn } from '../../src/components/auth-return'

afterEach(() => vi.unstubAllGlobals())

describe('protected page login return', () => {
  it('preserves the constituent route, query, and fragment through Payload login', () => {
    const current = '/admin/crm?view=contacts&site=default&contact=37cbade2&contactTab=information&infoSection=chapter#notes'
    const login = new URL(loginReturnURL('/admin', '/login', current), 'https://example.invalid')
    expect(login.pathname).toBe('/admin/login')
    expect(login.searchParams.get('redirect')).toBe(current)
  })
  it('uses the dashboard when the requested return is missing or unsafe', () => {
    for (const current of ['', 'https://evil.invalid/admin', '//evil.invalid/admin']) {
      const login = new URL(loginReturnURL('/admin', '/login', current), 'https://example.invalid')
      expect(login.searchParams.get('redirect')).toBe('/admin')
    }
  })
  it('restores query parameters omitted by Payload inactivity logout', () => {
    const values = new Map<string, string>()
    const replace = vi.fn()
    vi.stubGlobal('window', {
      location: { href: 'https://example.invalid/admin/logout-inactivity?redirect=%2Fadmin%2Fcrm' , replace },
      sessionStorage: { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) },
    })
    rememberReturnPath('/admin', '/admin/crm?view=contacts&contact=37cbade2')
    restoreInactivityReturn('/admin')
    const destination = new URL(replace.mock.calls[0][0], 'https://example.invalid')
    expect(destination.searchParams.get('redirect')).toBe('/admin/crm?view=contacts&contact=37cbade2')
  })
  it('does not replace an unrelated or unsafe login redirect', () => {
    const values = new Map<string, string>()
    const replace = vi.fn()
    vi.stubGlobal('window', {
      location: { href: 'https://example.invalid/admin/login?redirect=%2Fadmin%2Fcollections%2Fposts', replace },
      sessionStorage: { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) },
    })
    rememberReturnPath('/admin', '/admin/crm?view=contacts')
    restoreInactivityReturn('/admin')
    expect(replace).not.toHaveBeenCalled()
  })
})
