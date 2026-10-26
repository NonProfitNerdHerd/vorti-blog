import { describe, expect, it } from 'vitest'
import { enterNavigation, matchesAdminPath } from '../../src/components/navigation-state'
import { crmSections, crmURL, crmView } from '../../src/crm/navigation'

describe('page-local admin navigation', () => {
  it('starts collapsed and preserves manual groups while opening entered sections', () => {
    let state = enterNavigation(undefined, 'users:1', '/admin')
    expect(state.open).toEqual({})
    state = { ...state, open: { Forms: true } }
    state = enterNavigation(state, 'users:1', '/admin/crm?view=contacts', 'CRM')
    expect(state.open).toEqual({ Forms: true, CRM: true })
    const collapsed = { ...state, open: { ...state.open, CRM: false } }
    expect(enterNavigation(collapsed, 'users:1', collapsed.route, 'CRM')).toBe(collapsed)
    state = enterNavigation(collapsed, 'users:1', '/admin/crm?view=donations', 'CRM')
    expect(state.open).toEqual({ Forms: true, CRM: true })
  })
  it('resets after reload or user changes and follows back/forward routes', () => {
    const previous = { user: 'users:1', route: '/admin/crm', open: { CRM: true, Tasks: true } }
    expect(
      enterNavigation(undefined, 'users:1', '/admin/collections/posts', 'Content').open,
    ).toEqual({ Content: true })
    expect(enterNavigation(previous, 'users:2', '/admin').open).toEqual({})
    const next = enterNavigation(previous, 'users:1', '/admin/collections/posts', 'Content')
    expect(enterNavigation(next, 'users:1', '/admin/crm', 'CRM').open).toEqual({
      CRM: true,
      Tasks: true,
      Content: true,
    })
  })
  it('matches descendants without confusing neighboring collections and preserves CRM site links', () => {
    expect(matchesAdminPath('/admin/collections/posts/create', '/admin/collections/posts')).toBe(
      true,
    )
    expect(matchesAdminPath('/admin/collections/postscript', '/admin/collections/posts')).toBe(
      false,
    )
    expect(
      new URL(crmURL('/staff', 'contacts', 'chapter & one'), 'http://localhost').searchParams.get(
        'site',
      ),
    ).toBe('chapter & one')
    expect(crmSections).toHaveLength(11)
    expect(crmView('unknown')).toBe('overview')
    expect(crmView('attachments')).toBe('attachments')
    expect(crmView('record-tasks')).toBe('record-tasks')
  })
})
