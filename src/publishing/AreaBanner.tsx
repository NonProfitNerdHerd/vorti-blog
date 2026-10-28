'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'
import { useAdminSite } from '../organizations/AdminSiteProvider'

export function AreaBanner() {
  const params = useSearchParams(), pathname = usePathname(), { user } = useAuth(), { binding } = useAdminSite()
  const selected = params.get('audience') === 'intranet' ? 'intranet' : 'public'
  const internal = Array.isArray(user?.platformPermissions) && user.platformPermissions.some((permission: string) => permission.startsWith('intranet:read'))
  const href = (area: string) => {
    const next = new URLSearchParams(params.toString())
    next.set('audience', area)
    next.set('site', params.get('site') || binding?.site.id || 'default')
    next.delete('page')
    return `${pathname}?${next}`
  }
  const templates = pathname.endsWith('/site-templates')
  return <nav aria-label="Publishing area" style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', padding: '1rem 0', borderBottom: '1px solid var(--theme-elevation-150)' }}>
    <a href={href('public')} aria-current={selected === 'public' ? 'page' : undefined}>{templates ? 'Main and public templates' : 'Public Content'}</a>
    {internal && <a href={href('intranet')} aria-current={selected === 'intranet' ? 'page' : undefined}>{templates ? 'Intranet templates' : 'Intranet'}</a>}
  </nav>
}
