import type { PayloadRequest } from 'payload'
/** Only the invitation redemption handler may grant this one-account creation scope. */
export const INVITED_ACCOUNT = Symbol('validated-invited-account')
export function invitedAccountEmail(req:PayloadRequest) {
  const value=(req.context as Record<symbol,unknown>)[INVITED_ACCOUNT]
  return typeof value==='string'?value:null
}
