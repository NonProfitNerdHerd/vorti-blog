import { describe, expect, it } from 'vitest'
import { siteCalendarDay, siteWeek, secondsInWindow } from '@/review/workspace-dates'
import { nextTaskDay } from '@/review/dashboard-model'

describe('Workspace calendar dates and actual work intervals', () => {
  it('uses site-local weeks across daylight saving without shifting task dates', () => {
    const spring = siteWeek('2026-03-08', 'America/Chicago'),
      fall = siteWeek('2026-11-01', 'America/Chicago')
    expect((spring.end - spring.start) / 3600000).toBe(167)
    expect((fall.end - fall.start) / 3600000).toBe(169)
    expect(nextTaskDay('2026-03-08', 1)).toBe('2026-03-09')
    expect(siteCalendarDay('2026-03-09T04:30:00Z', 'America/Chicago')).toBe('2026-03-08')
  })
  it('splits recorded work at site-local week boundaries', () => {
    const start = '2026-03-09T04:30:00Z',
      end = '2026-03-09T06:30:00Z'
    expect(secondsInWindow(start, end, siteWeek('2026-03-08', 'America/Chicago'))).toBe(1800)
    expect(secondsInWindow(start, end, siteWeek('2026-03-09', 'America/Chicago'))).toBe(5400)
  })
})
