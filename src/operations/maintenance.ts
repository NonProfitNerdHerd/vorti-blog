import { constantEqual } from '../forms/security'

export interface OperationsEnvironment {
  OPERATIONS?: D1Database
  RELEASE_TARGET?: string
  RELEASE_OPERATOR_TOKEN?: string
}

/** Operational state survives replacement of the application database. Missing or
 * unavailable state fails closed once an installation declares its release target. */
export async function maintenanceRequired(env: OperationsEnvironment): Promise<boolean> {
  if (!env.RELEASE_TARGET) return false
  if (!env.OPERATIONS) return true
  const run = await env.OPERATIONS.prepare(
    "SELECT phase FROM release_runs WHERE target=? AND phase NOT IN('complete','aborted')",
  )
    .bind(env.RELEASE_TARGET)
    .first<{ phase: string }>()
  return !!run && ['frozen', 'cutover', 'verifying', 'recovering'].includes(run.phase)
}

export function operationalProbe(request: Request, env: OperationsEnvironment) {
  const supplied = request.headers.get('x-vorti-release-probe') || ''
  return (
    !!env.RELEASE_OPERATOR_TOKEN &&
    env.RELEASE_OPERATOR_TOKEN.length >= 32 &&
    constantEqual(supplied, env.RELEASE_OPERATOR_TOKEN)
  )
}

export const maintenanceResponse = () =>
  new Response('VortiCause is being updated. Please try again shortly.', {
    status: 503,
    headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '60' },
  })
