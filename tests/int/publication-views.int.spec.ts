import { describe, expect, it } from 'vitest'
import {
  publicationDate,
  publicationDay,
  publicationDays,
  publicationPeriod,
  shiftPublicationDate,
} from '../../src/components/publication-model'
import { publicationTimestamp } from '../../src/collections/publicationTimestamp'
describe('publication views', () => {
  it('uses calendar months, Monday-first weeks, and exact day boundaries', () => {
    const date = new Date(2026, 9, 20, 12)
    const month = publicationPeriod(date, 'month')
    expect(publicationDay(month.start)).toBe('2026-10-01')
    expect(publicationDay(month.end)).toBe('2026-11-01')
    expect(publicationDays(month.start, month.end)).toHaveLength(31)
    const week = publicationPeriod(date, 'week')
    expect(publicationDay(week.start)).toBe('2026-10-19')
    expect(publicationDays(week.start, week.end)).toHaveLength(7)
    expect(
      publicationDays(...(Object.values(publicationPeriod(date, 'day')) as [Date, Date])),
    ).toHaveLength(1)
  })
  it('moves across year/month boundaries without date overflow', () => {
    expect(publicationDay(shiftPublicationDate(new Date(2026, 0, 31), 'month', 1))).toBe(
      '2026-02-01',
    )
    expect(publicationDay(shiftPublicationDate(new Date(2026, 0, 1), 'week', -1))).toBe(
      '2025-12-25',
    )
    expect(publicationDay(publicationDate('2026-02-28'))).toBe('2026-02-28')
    expect(publicationDay(publicationDate('2026-02-31'))).toBe(publicationDay(new Date()))
  })
  const apply = (data: Record<string, unknown>, originalDoc?: Record<string, unknown>) =>
    publicationTimestamp({ data, originalDoc } as never) as Record<string, unknown>
  it('timestamps publication while preserving explicit dates and undated historical documents', () => {
    expect(apply({ _status: 'published' }).publishedAt).toEqual(expect.any(String))
    expect(apply({ _status: 'draft' }).publishedAt).toBeUndefined()
    expect(apply({ title: 'Unrelated' }, { _status: 'published' }).publishedAt).toBeUndefined()
    expect(apply({ _status: 'published' }, { _status: 'published' }).publishedAt).toBeUndefined()
    expect(apply({ _status: 'published', publishedAt: '2026-01-02T00:00:00Z' }).publishedAt).toBe(
      '2026-01-02T00:00:00Z',
    )
    expect(
      apply({ _status: 'published' }, { _status: 'draft', publishedAt: '2026-01-02T00:00:00Z' })
        .publishedAt,
    ).toBeUndefined()
  })
})
