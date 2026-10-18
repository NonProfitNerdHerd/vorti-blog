import { describe, expect, it, vi } from 'vitest'
import { manageTags } from '@/access/tags'
import { validateSiteSettings } from '@/lib/site-settings-validation'
import { homePage, postsPath, privacyPath } from '@/lib/site-pages'
import { formatSiteDate, formatSiteTime } from '@design-system/payload-design-core/content'
import { SystemSettings } from '@/globals/SystemSettings'

describe('Settings hub policies', () => {
  it('enforces the role matrix and retains legacy editor access by default', async () => {
    for (const role of ['administrator', 'designer', 'editor', undefined]) {
      const req = {
        user: { role },
        payload: {
          findGlobal: vi
            .fn()
            .mockResolvedValue({ tagManagementRoles: ['administrator', 'designer'] }),
        },
      }
      expect(await manageTags({ req } as never)).toBe(
        role === 'administrator' || role === 'designer',
      )
    }
    expect(await manageTags({ req: { user: null } } as never)).toBe(false)
    expect(
      await manageTags({
        req: { user: { role: 'editor' }, payload: { findGlobal: async () => ({}) } },
      } as never),
    ).toBe(true)
  })
  it('always retains Administrator in stored tag permissions', () => {
    const field = SystemSettings.fields.find((f) => 'name' in f && f.name === 'tagManagementRoles')
    if (!field || !('hooks' in field)) throw new Error('Missing role field')
    expect(field.hooks!.beforeValidate![0]({ value: ['editor'] } as never)).toEqual([
      'administrator',
      'editor',
    ])
  })
  it('rejects matching home/posts selections and draft or reserved destinations', async () => {
    const req = { payload: { find: vi.fn().mockResolvedValue({ docs: [] }) } }
    await expect(
      validateSiteSettings({ data: { homepage: 2, blogPage: 2 }, req } as never),
    ).rejects.toThrow()
    await expect(
      validateSiteSettings({ data: { privacyPolicyPage: 3 }, req } as never),
    ).rejects.toThrow()
    req.payload.find.mockResolvedValue({ docs: [{ id: 2, slug: 'admin', _status: 'published' }] })
    await expect(validateSiteSettings({ data: { homepage: 2 }, req } as never)).rejects.toThrow()
    await expect(
      validateSiteSettings({
        data: { siteTagline: 'Unrelated' },
        originalDoc: { homepage: 4 },
        req,
      } as never),
    ).resolves.toEqual({ siteTagline: 'Unrelated' })
  })
  it('only exposes published destinations and keeps safe fallbacks', () => {
    const page = { id: 7, slug: 'welcome', _status: 'published' }
    const site = {
      homepage: page,
      blogPage: { ...page, id: 8, slug: 'news' },
      privacyPolicyPage: page,
      showPrivacyPolicyLink: true,
    }
    expect(homePage(site as never)?.id).toBe(7)
    expect(postsPath(site as never)).toBe('/news')
    expect(privacyPath(site as never)).toBe('/')
    expect(postsPath({ blogPage: { ...page, _status: 'draft' } } as never)).toBe('/posts')
    expect(homePage({ homepage: 7 } as never)).toBeNull()
    expect(privacyPath({ ...site, showPrivacyPolicyLink: false } as never)).toBeNull()
    expect(privacyPath({ ...site, privacyPolicyPage: null } as never)).toBeNull()
  })
})

describe('Site date/time formats', () => {
  it('formats every preset and keeps date-only values independent of timezone', () => {
    for (const [dateFormat, expected] of [
      ['long', 'October 17, 2026'],
      ['short', 'Oct 17, 2026'],
      ['iso', '2026-10-17'],
      ['us', '10/17/2026'],
      ['day-first', '17/10/2026'],
    ]) {
      expect(formatSiteDate('2026-10-17', { timezone: 'Pacific/Honolulu', dateFormat })).toBe(
        expected,
      )
    }
    expect(
      formatSiteDate('2026-10-17T00:30:00Z', { timezone: 'America/Chicago', dateFormat: 'iso' }),
    ).toBe('2026-10-16')
    expect(
      formatSiteDate(
        '2026-10-17T00:30:00Z',
        { timezone: 'America/Chicago', dateFormat: 'iso' },
        'UTC',
      ),
    ).toBe('2026-10-17')
  })
  it('honors daylight saving and explicit schedule zones without the browser timezone', () => {
    expect(
      formatSiteTime('2026-03-08T07:30:00Z', { timezone: 'America/Chicago', timeFormat: '24' }),
    ).toBe('01:30')
    expect(
      formatSiteTime('2026-03-08T08:30:00Z', { timezone: 'America/Chicago', timeFormat: '24' }),
    ).toBe('03:30')
    expect(formatSiteTime('2026-10-17T13:30:00Z', { timeFormat: '12' }, 'UTC')).toBe('01:30 PM')
  })
})
