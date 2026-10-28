import type { ReleaseLease } from './release-lock'

/** Only the active data-preserving lease may temporarily remove database guards.
 * HTTP maintenance and paused dispatch remain active throughout these operations.
 */
export function assertUpgradeState(input: {
  lease: ReleaseLease
  actual: { id: string; target: string; phase: string; revision: number; mode: string } | null
  action: 'migrate' | 'verify-schema' | 'verification-thaw'
  applicationID: string
  operationsID: string
  baselineApplicationID: string
  recoveryVerified: boolean
  artifactVerified: boolean
}) {
  const { lease, actual } = input
  if (!actual || actual.id !== lease.id || actual.target !== lease.target || actual.phase !== lease.phase ||
      actual.revision !== lease.revision || actual.mode !== 'upgrade') throw Error('A current upgrade lease is required.')
  if (!input.applicationID || input.applicationID === input.operationsID || input.applicationID !== input.baselineApplicationID)
    throw Error('The upgrade must retain the baseline application database and separate operational database.')
  if (!input.recoveryVerified || !input.artifactVerified) throw Error('Verified recovery and the tested artifact are required.')
  if (lease.phase !== (input.action === 'verification-thaw' ? 'verifying' : 'frozen'))
    throw Error('Database guards may only change during protected migration or verification.')
}
