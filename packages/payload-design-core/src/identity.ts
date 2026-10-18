export type AttributionUser = {
  username?: string | null
  email?: string | null
  displayName?: string | null
  attributionPreference?: 'username' | 'email' | null
  attributionLabel?: string | null
  profilePublic?: boolean | null
}

/** Legacy callers supply their previous fallback; opted-in accounts share one identity. */
export function userIdentity(
  user: AttributionUser | null | undefined,
  legacy?: string | null,
): string {
  if (!user) return ''
  if (user.attributionPreference === 'username') return user.username || ''
  if (user.attributionPreference === 'email') return user.email || ''
  return legacy ?? user.displayName ?? user.email ?? ''
}

export function publicAuthorIdentity(user: AttributionUser | null | undefined): string {
  return userIdentity(user, user?.profilePublic ? user.displayName || '' : '')
}
