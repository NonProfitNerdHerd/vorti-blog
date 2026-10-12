import { describe, expect, it } from 'vitest'
import { taskSearchTerms } from '@/review/client'

describe('D1-safe task search', () => {
  it('supports full titles and Unicode without oversized LIKE patterns', () => {
    for (const value of [
      'Review mobile spacing review-browser-1791762600807',
      '📝'.repeat(50),
      'a'.repeat(120),
    ]) {
      const terms = taskSearchTerms(value)
      expect(terms.length).toBeGreaterThan(0)
      for (const term of terms)
        expect(new TextEncoder().encode(`%${term}%`).length).toBeLessThanOrEqual(50)
    }
  })
  it('bounds query parameter count for many short words', () => {
    expect(taskSearchTerms('a '.repeat(100)).length).toBeLessThanOrEqual(60)
    expect(taskSearchTerms('   ')).toEqual([])
  })
})
