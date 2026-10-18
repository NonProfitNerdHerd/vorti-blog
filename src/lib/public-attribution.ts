import type { Payload } from 'payload'
import { publicAuthorIdentity } from '@design-system/payload-design-core'

/** Private user lookup; only the deliberately public identity crosses into rendering. */
export async function publicAuthors(payload: Payload, references: unknown[]) {
  const ids = [
    ...new Set(
      references
        .map((value) =>
          typeof value === 'object' && value ? (value as { id?: number }).id : value,
        )
        .filter((id): id is number => typeof id === 'number'),
    ),
  ]
  const authors = new Map<number, Record<string, unknown>>()
  if (!ids.length) return authors
  const result = await payload.find({
    collection: 'users',
    where: { id: { in: ids } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    select: {
      username: true,
      email: true,
      displayName: true,
      attributionPreference: true,
      profilePublic: true,
      slug: true,
    },
  })
  for (const user of result.docs) {
    const label = publicAuthorIdentity(user)
    authors.set(user.id, {
      id: user.id,
      displayName: label,
      profilePublic: user.profilePublic,
      slug: user.profilePublic ? user.slug : undefined,
      attributionPreference: user.attributionPreference,
      ...(user.attributionPreference === 'username'
        ? { username: label }
        : user.attributionPreference === 'email'
          ? { email: label }
          : {}),
    })
  }
  return authors
}
