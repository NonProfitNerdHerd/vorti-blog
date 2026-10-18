import { describe, expect, it } from 'vitest'
import { publicAuthorIdentity, userIdentity } from './identity'
import { templateContentNodes } from './content/template-adapter'

describe('Shared author identity', () => {
  const user = {
    username: 'writer',
    email: 'writer@example.com',
    displayName: 'Old name',
    profilePublic: false,
  }
  it('applies an explicit choice regardless of profile visibility', () => {
    expect(publicAuthorIdentity({ ...user, attributionPreference: 'username' })).toBe('writer')
    expect(publicAuthorIdentity({ ...user, attributionPreference: 'email' })).toBe(user.email)
    expect(userIdentity({ ...user, attributionPreference: 'username' })).toBe('writer')
  })
  it('keeps legacy per-surface fallback and profile gating', () => {
    expect(userIdentity(user, user.email)).toBe(user.email)
    expect(userIdentity(user, user.displayName)).toBe('Old name')
    expect(publicAuthorIdentity(user)).toBe('')
    expect(publicAuthorIdentity({ ...user, profilePublic: true })).toBe('Old name')
  })
  it('uses selected identity for template relationship fields', () => {
    const template = {
      id: 't',
      name: 'Author',
      customFields: [] as never[],
      layout: [
        {
          id: 'author',
          type: 'field',
          fieldType: 'shortText',
          content: { source: 'document', field: 'author' },
        },
      ],
    }
    for (const attributionPreference of ['username', 'email'] as const) {
      const nodes = templateContentNodes(
        template as never,
        { author: { ...user, attributionPreference } },
        [],
        [],
      )
      expect(nodes[0].text).toBe(attributionPreference === 'username' ? user.username : user.email)
    }
  })
})
