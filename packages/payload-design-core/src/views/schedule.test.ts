import { describe, it, expect } from 'vitest'
import { expandSchedule, eventInstant, validateSchedule } from './schedule'
import { listViews, occurrenceLanes, type EventSchedule, type ViewItem } from './model'
import { listBlockDefinitions } from '../blocks/registry'
import { blockGlyphs } from '../blocks/BlockGlyph'
const series: EventSchedule = {
  start: '2026-03-01T09:00',
  end: '2026-03-01T10:00',
  timezone: 'America/Chicago',
  frequency: 'weekly',
  weekdays: [0],
}
describe('Event schedules and display registrations', () => {
  it('keeps overlapping calendar entries in stable lanes and resets separate groups', () => {
    const item = (id: string, start: string, end: string): ViewItem => ({
      id,
      title: id,
      url: '/',
      occurrence: {
        id,
        start: `2026-10-12T${start}:00Z`,
        end: `2026-10-12T${end}:00Z`,
        originalDate: '2026-10-12',
        allDay: false,
        timezone: 'UTC',
      },
    })
    const lanes = occurrenceLanes([
      item('a', '09:00', '11:00'),
      item('b', '10:00', '12:00'),
      item('c', '11:00', '13:00'),
      item('d', '14:00', '15:00'),
    ])
    expect(lanes.get('a')).toEqual({ lane: 0, lanes: 2 })
    expect(lanes.get('b')).toEqual({ lane: 1, lanes: 2 })
    expect(lanes.get('c')).toEqual({ lane: 0, lanes: 2 })
    expect(lanes.get('d')).toEqual({ lane: 0, lanes: 1 })
  })
  it('preserves local weekly time through DST', () => {
    const events = expandSchedule(
      series,
      Date.parse('2026-03-01'),
      Date.parse('2026-03-20'),
      'event',
    )
    expect(events.map((e) => e.start)).toEqual([
      '2026-03-01T15:00:00.000Z',
      '2026-03-08T14:00:00.000Z',
      '2026-03-15T14:00:00.000Z',
    ])
    expect(events[1].end).toBe('2026-03-08T15:00:00.000Z')
  })
  it('rejects ambiguous and nonexistent user times', () => {
    expect(() => eventInstant('2026-03-08T02:30', 'America/Chicago')).toThrow()
    expect(() => eventInstant('2026-11-01T01:30', 'America/Chicago')).toThrow()
    expect(eventInstant('2026-11-01T01:30:00-05:00', 'America/Chicago')).toBe(
      Date.parse('2026-11-01T06:30Z'),
    )
  })
  it('retains stable IDs through cancellations and rescheduling', () => {
    const result = expandSchedule(
      {
        ...series,
        exceptions: [
          { date: '2026-03-08', cancelled: true },
          { date: '2026-03-15', start: '2026-03-16T11:00', end: '2026-03-16T12:00' },
        ],
      },
      Date.parse('2026-03-01'),
      Date.parse('2026-03-20'),
      '42',
    )
    expect(result).toHaveLength(2)
    expect(result[1].id).toBe('42:2026-03-15')
    expect(result[1].start).toBe('2026-03-16T16:00:00.000Z')
  })
  it('keeps positive durations through a generated DST gap and respects an explicit first fold', () => {
    const gap = expandSchedule(
      { ...series, start: '2026-03-01T02:30', end: '2026-03-01T03:30' },
      Date.parse('2026-03-08'),
      Date.parse('2026-03-09'),
      'gap',
    )
    expect(gap[0].end).toBe('2026-03-08T09:30:00.000Z')
    const fold = expandSchedule(
      { ...series, start: '2026-11-01T01:30:00-06:00', end: '2026-11-01T02:30:00-06:00' },
      Date.parse('2026-11-01'),
      Date.parse('2026-11-02'),
      'fold',
    )
    expect(fold[0].start).toBe('2026-11-01T07:30:00.000Z')
  })
  it('handles month ends, leap years, counts, and overlapping dates', () => {
    const s = {
      ...series,
      start: '2024-01-31T09:00',
      end: '2024-02-02T10:00',
      frequency: 'monthly' as const,
      count: 2,
    }
    const results = expandSchedule(s, Date.parse('2024-02-01'), Date.parse('2024-04-30'), 'x')
    expect(results.map((e) => e.originalDate)).toEqual(['2024-01-31', '2024-03-31'])
    const leap = expandSchedule(
      { ...series, start: '2024-02-29T09:00', end: '2024-02-29T10:00', frequency: 'yearly' },
      Date.parse('2028-01-01'),
      Date.parse('2028-12-31'),
      'x',
    )
    expect(leap).toHaveLength(1)
  })
  it('validates schedule limits and all-day exclusive ends', () => {
    expect(() => validateSchedule({ ...series, end: series.start })).toThrow()
    expect(() => expandSchedule(series, 0, 367 * 86400000, 'x')).toThrow()
    const s = {
      ...series,
      start: '2026-03-07',
      end: '2026-03-10',
      allDay: true,
      frequency: 'none' as const,
    }
    expect(expandSchedule(s, Date.parse('2026-03-09'), Date.parse('2026-03-10'), 'x')).toHaveLength(
      1,
    )
  })
  it('registers all 36 agreed layouts and distinct block identity artwork', () => {
    expect(listViews()).toHaveLength(36)
    const paths = listBlockDefinitions().map((d) => blockGlyphs[d.type])
    expect(paths.every(Boolean)).toBe(true)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
