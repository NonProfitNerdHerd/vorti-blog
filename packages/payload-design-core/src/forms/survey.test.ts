import { describe, expect, it } from 'vitest'
import { surveyAccumulator } from './survey'
import { formFields } from './registry'
import type { FormField } from './model'

const options = [{ id: 'a', label: 'First', value: 'first' }, { id: 'b', label: 'Second', value: 'second' }]
describe('survey summaries', () => {
  it('excludes free text and sensitive descendants, retaining stable option labels', () => {
    const report = surveyAccumulator([{ id: 'choice', kind: 'radio', label: 'Choice', options }, { id: 'text', kind: 'text', label: 'Name' },
      { id: 'private', kind: 'section', label: 'Private', sensitive: true, children: [{ id: 'secret', kind: 'radio', label: 'Secret', options }] }])
    report.add({ choice: 'a', text: 'Private person', secret: 'b' })
    report.add({ choice: 'unknown' })
    expect(report.result()).toEqual([{ id: 'choice', kind: 'radio', label: 'Choice', repeated: false, responses: 1, buckets: [{ id: 'a', label: 'First', count: 1 }, { id: 'b', label: 'Second', count: 0 }] }])
  })
  it('computes NPS from valid integer scores without accepting numeric tampering', () => {
    const report = surveyAccumulator([{ id: 'score', kind: 'nps', label: 'Recommend' }])
    for (const score of [0, 7, 9, 10, 100, 8.5, '10']) report.add({ score })
    expect(report.result()[0]).toMatchObject({ responses: 4, nps: 25, mean: 6.5 })
    expect(formFields.get('rating')!.validate(6, { id: 'r', kind: 'rating', label: 'Rating' })).not.toEqual([])
  })
  it('counts repeated items, multi-selects, matrix rows, booleans, and ranking positions', () => {
    const fields: FormField[] = [{ id: 'items', kind: 'repeater', label: 'Items', children: [{ id: 'rating', kind: 'rating', label: 'Rating' }] },
      { id: 'many', kind: 'multiSelect', label: 'Many', options }, { id: 'rank', kind: 'ranking', label: 'Rank', options },
      { id: 'matrix', kind: 'likert', label: 'Matrix', options, rows: [{ id: 'row', label: 'Service', value: 'service' }] }, { id: 'yes', kind: 'checkbox', label: 'Yes?' }]
    const report = surveyAccumulator(fields)
    report.add({ items: [{ rating: 2 }, { rating: 4 }], many: ['a', 'b'], rank: ['b', 'a'], matrix: { row: 'a' }, yes: false })
    expect(report.result()[0]).toMatchObject({ repeated: true, responses: 2, mean: 3 })
    expect(report.result()[1].buckets.map(x => x.count)).toEqual([1, 1])
    expect(report.result()[2].buckets.map(x => x.rankTotal)).toEqual([2, 1])
    expect(report.result()[3].rows?.[0]).toMatchObject({ responses: 1, buckets: [{ id: 'a', label: 'First', count: 1 }, { id: 'b', label: 'Second', count: 0 }] })
    expect(report.result()[4].buckets[1].count).toBe(1)
    const snapshot = report.result(); snapshot[0].responses = 999
    expect(report.result()[0].responses).toBe(2)
  })
})
