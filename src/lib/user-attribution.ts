import { ValidationError, type CollectionBeforeValidateHook } from 'payload'
import { userIdentity } from '@design-system/payload-design-core'
import { slugify } from '../fields/slug'

export const prepareUserIdentity: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (!data) return data
  const value = { ...originalDoc, ...data }
  if (typeof data.email === 'string') data.email = data.email.trim().toLowerCase()
  const fail = (path: string, message: string): never => {
    throw new ValidationError({ errors: [{ path, message }] })
  }
  if (Object.hasOwn(data, 'username'))
    data.username =
      typeof data.username === 'string' ? data.username.trim().toLowerCase() || null : null
  const username = Object.hasOwn(data, 'username') ? data.username : originalDoc?.username
  if ((operation === 'create' || originalDoc?.username) && !username)
    fail('username', 'A username is required.')
  if (username && !/^[a-z0-9._-]{3,32}$/.test(username))
    fail(
      'username',
      'Use 3–32 letters, numbers, dots, underscores, or hyphens. Spaces and @ are not allowed.',
    )
  if (operation === 'create' && !data.attributionPreference) data.attributionPreference = 'username'
  const preference = Object.hasOwn(data, 'attributionPreference')
    ? data.attributionPreference
    : originalDoc?.attributionPreference
  if (originalDoc?.attributionPreference && !preference)
    fail(
      'attributionPreference',
      'Choose Username or Email; legacy attribution cannot be restored.',
    )
  if (preference && !['username', 'email'].includes(preference))
    fail('attributionPreference', 'Choose Username or Email.')
  if (preference === 'username' && !username)
    fail('username', 'Set a username before displaying it.')
  data.attributionLabel = userIdentity(
    { ...value, email: data.email ?? value.email, username, attributionPreference: preference },
    data.email || value.email || '',
  )
  if (!value.slug && (username || value.displayName)) {
    const base = slugify(username || value.displayName) || 'author'
    const existing = await req.payload.count({
      collection: 'users',
      where: { slug: { equals: base } },
      overrideAccess: true,
      req,
    })
    data.slug = existing.totalDocs ? `${base}-${crypto.randomUUID().slice(0, 8)}` : base
  }
  return data
}
