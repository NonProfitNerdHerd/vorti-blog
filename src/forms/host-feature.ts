import { FormHTTPError } from './security'

/** Host context is bound into the form session. A standalone form can start its
 * own session, but cannot reuse an embedded session after its host is disabled. */
export function formHostFeature(headers: Headers): 'pages' | 'posts' | 'wiki' | 'intranet' | undefined {
  const value = headers.get('x-vorti-form-host')
  if (!value) return undefined
  if (value === 'pages' || value === 'posts' || value === 'wiki' || value === 'intranet') return value
  throw new FormHTTPError('This form placement is unavailable.', 404)
}

export function formSessionScope(revision: string, headers: Headers) {
  const host = formHostFeature(headers)
  return host ? `${revision}:host:${host}` : revision
}
