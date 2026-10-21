import type { InformationCategory, SiteOperation } from './policy'
export const SERVER_AUTHORITY = Symbol('server-derived-site-authority')
export interface AuthorityClaim {
  actor: number
  site: string
  organization: string
  epoch: number
  operator: boolean
  bootstrap: boolean
  allowed: Partial<Record<InformationCategory, SiteOperation[]>>
}
export interface ClaimedUser {
  id: string | number
  platformAuthority?: unknown
  [SERVER_AUTHORITY]?: AuthorityClaim
}
const registryKey = Symbol.for('vorticause.server-authority-witnesses')
const registries = globalThis as typeof globalThis & {
  [registryKey]?: WeakMap<object, AuthorityClaim>
}
const registered = (registries[registryKey] ||= new WeakMap<object, AuthorityClaim>())
/** A plain witness survives auth's shallow copies and React serialization without exposing
 * organization IDs or capabilities. Only its original server object resolves authority. */
export function withAuthority<T extends { id: string | number }>(
  user: T,
  claim: AuthorityClaim,
): T & { platformAuthority: { actor: number } } {
  if (claim.actor !== Number(user.id)) throw new Error('Authority actor mismatch.')
  const witness = Object.freeze({ actor: claim.actor })
  registered.set(witness, claim)
  const result = { ...user, platformAuthority: witness }
  // Auth documents also cross the RSC boundary. Do not propagate internal markers from
  // an earlier server operation or a development hot-reload into client props.
  for (const symbol of Object.getOwnPropertySymbols(result))
    delete (result as Record<symbol, unknown>)[symbol]
  return result
}
export const authorityClaim = (user: ClaimedUser | null | undefined): AuthorityClaim | null => {
  const value = user?.platformAuthority
  const claim =
    user?.[SERVER_AUTHORITY] || (value && typeof value === 'object' ? registered.get(value) : null)
  return claim && claim.actor === Number(user?.id) ? claim : null
}
