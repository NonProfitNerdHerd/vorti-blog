import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { cmsSiteContext } from '../organizations/cms-scope'

export type RenderScope = { draft?: boolean; user?: PayloadRequest['user']; site?: string }
export async function rendererRequest(payload: Payload, context: RenderScope, site?: unknown) {
  const selected = typeof site === 'string' ? site : context.site
  return createLocalReq({user:context.user,context:selected ? cmsSiteContext(selected) : {}},payload)
}
