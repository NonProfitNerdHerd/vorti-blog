import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

/** Operational-only exception. It never turns incomplete tests into passing
 * results, and never bypasses source, artifact, target or recovery checks. */
export function releaseValidationWaiver(file, source, worker) {
  if (!file) return null
  const bytes = readFileSync(file), waiver = JSON.parse(bytes)
  if (waiver.status !== 'user-authorized-incomplete-validation' || waiver.source !== source ||
      waiver.worker !== worker || waiver.userAuthorized !== true || !/^[a-f0-9]{40}$/.test(source) ||
      typeof waiver.authorization !== 'string' || waiver.authorization.length < 30 ||
      typeof waiver.reason !== 'string' || !waiver.reason.trim() ||
      !Array.isArray(waiver.outstandingGates) || !waiver.outstandingGates.length)
    throw Error('An explicit, source- and target-bound user validation waiver is required.')
  return { ...waiver, sha256: createHash('sha256').update(bytes).digest('hex') }
}
