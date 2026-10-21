import type { PayloadRequest } from 'payload'
import { authorityClaim } from './claims'
export interface WorkspaceAuthority {
  organization: string
  site: string
  epoch: number
  actor: number
}
export function workspaceAuthority(req: PayloadRequest): WorkspaceAuthority | null {
  const claim = authorityClaim(req.user)
  return !claim || claim.bootstrap
    ? null
    : { organization: claim.organization, site: claim.site, epoch: claim.epoch, actor: claim.actor }
}
export function workspaceAuthorityCheck(authority: WorkspaceAuthority) {
  return {
    query:
      'EXISTS(SELECT 1 FROM vc_organizations WHERE id=? AND authority_revision=? AND NOT EXISTS(SELECT 1 FROM vc_account_status WHERE user_id=? AND disabled=1))',
    values: [authority.organization, authority.epoch, authority.actor],
  }
}
