import { describe, expect, it } from 'vitest'
import { heroBoardFields } from './hero-board/registration'
import { validateContentValues, validateFieldDefinitions } from './validation'

describe('controlled content schema', () => {
  it('accepts a complete Hero Board value set', () => {
    expect(validateFieldDefinitions(heroBoardFields)).toEqual([])
    expect(validateContentValues({ fields: heroBoardFields }, {
      headline: 'Example Headline',
      eyebrow: 'News',
      primaryCTA: { label: 'Read more', url: '/story' },
      backgroundImage: 4,
    })).toEqual([])
  })

  it('requires headline in a required section and rejects invalid nested values', () => {
    expect(validateContentValues({ fields: heroBoardFields }, {
      primaryCTA: { label: 'Open', url: 'javascript:alert(1)' },
      backgroundImage: { missingID: true },
      unexpected: 'copied design',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'headline', message: 'Headline is required' }),
      expect.objectContaining({ path: 'primaryCTA.url' }),
      expect.objectContaining({ path: 'backgroundImage' }),
      expect.objectContaining({ path: 'unexpected' }),
    ]))
  })

  it('supports optional sections without requiring their optional values', () => {
    expect(validateContentValues({ fields: heroBoardFields }, {}, false)).toEqual([])
  })
})
