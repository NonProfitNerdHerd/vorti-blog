import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { cmsSiteContext } from '../organizations/cms-scope'
import { CMS_AUDIENCE, CMS_PUBLIC_RENDER, type Audience } from '../publishing/readership'

export type RenderScope = { draft?: boolean; user?: PayloadRequest['user']; site?: string; audience?: Audience }
export async function rendererRequest(payload: Payload, context: RenderScope, site?: unknown) {
  const selected = typeof site === 'string' ? site : context.site
  const internal = context.audience === 'intranet'
  return createLocalReq({user:context.user,context:{ ...(selected ? cmsSiteContext(selected) : {}),
    [CMS_AUDIENCE]: internal ? 'intranet' : 'public', [CMS_PUBLIC_RENDER]: !internal }},payload)
}
