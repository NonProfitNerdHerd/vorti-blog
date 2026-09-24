import { getPayload } from 'payload'
import config from '../../src/payload.config.js'
import { heroBoardFields, heroBoardDesigns } from '@design-system/payload-design-core/hero-board/registration'

export const testUser = {
  email: 'dev@payloadcms.com',
  password: 'test',
  role: 'administrator' as const,
}

/**
 * Seeds a test user for e2e admin tests.
 */
export async function seedTestUser(): Promise<void> {
  const payload = await getPayload({ config })

  // Delete existing test user if any
  await payload.delete({
    collection: 'users',
    where: {
      email: {
        equals: testUser.email,
      },
    },
  })

  // Create fresh test user
  await payload.create({
    collection: 'users',
    data: testUser,
  })

  const existing = await payload.find({ collection: 'design-block-types', where: { slug: { equals: 'hero-board' } }, limit: 1, depth: 0, overrideAccess: true })
  const hero = existing.docs[0] ?? await payload.create({
    collection: 'design-block-types',
    overrideAccess: true,
    data: { name: 'Hero Board', slug: 'hero-board', description: 'Browser test fixture.', rendererKey: 'hero-board', schemaVersion: 1, status: 'published', _status: 'published', fields: heroBoardFields as never },
  })
  for (const variant of heroBoardDesigns) {
    const found = await payload.find({ collection: 'design-block-designs', where: { slug: { equals: variant.slug } }, limit: 1, depth: 0, overrideAccess: true })
    if (!found.docs[0]) await payload.create({ collection: 'design-block-designs', overrideAccess: true, data: { name: variant.name, slug: variant.slug, blockType: hero.id, status: 'published', _status: 'published', design: variant.design as never } })
  }
}

/**
 * Cleans up test user after tests
 */
export async function cleanupTestUser(): Promise<void> {
  const payload = await getPayload({ config })

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await payload.delete({
        collection: 'users',
        where: {
          email: {
            equals: testUser.email,
          },
        },
      })
      return
    } catch (error) {
      if (attempt === 4 || !String(error).includes('SQLITE_BUSY')) throw error
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
}
