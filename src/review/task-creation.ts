import { APIError, type PayloadRequest } from 'payload'
import { authorityClaim } from '../organizations/claims'
import { claimRequest } from '../organizations/identity-authority'
import { workspaceDB } from './workspace-access'

export async function creationIdentity(req: PayloadRequest, key: unknown) {
  if (!req.user) throw new APIError('Sign in to create a task.', 401)
  await claimRequest(req)
  if (typeof key !== 'string' || !/^[a-f\d-]{36}$/i.test(key))
    throw new APIError('A valid creation request key is required.', 400)
  return `${authorityClaim(req.user)?.site ?? 'default'}:${req.user.id}:${key}`
}
async function signature(value: unknown) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
/** The task's unique key arbitrates concurrent requests; all writes still run normal hooks. */
export async function createTaskOnce(req: PayloadRequest, body: Record<string, any>) {
  const key = await creationIdentity(req, body.clientRequestKey)
  const { clientRequestKey, creationKey: _key, creationSignature: _signature, ...data } = body
  const fingerprint = await signature(data)
  const publicTask = (id: number) =>
    req.payload.findByID({ collection: 'review-tasks', id, req, overrideAccess: false, depth: 0 })
  const existing = async () => {
    const doc = await workspaceDB(req)
      .prepare('SELECT id,creation_signature AS fingerprint FROM review_tasks WHERE creation_key=?')
      .bind(key)
      .first<{ id: number; fingerprint: string }>()
    if (!doc) return
    if (doc.fingerprint !== fingerprint)
      throw new APIError(
        'This request key belongs to a different task. Retry the original request.',
        409,
      )
    return publicTask(doc.id)
  }
  const previous = await existing()
  if (previous) return previous
  try {
    const created = await req.payload.create({
      collection: 'review-tasks',
      req,
      overrideAccess: false,
      depth: 0,
      data: { ...data, clientRequestKey, creationSignature: fingerprint } as any,
    })
    return publicTask(created.id)
  } catch (error) {
    const winner = await existing()
    if (winner) return winner
    throw error
  }
}
