import { expect, it } from 'vitest'
import { requireAudienceSafeBaseline } from '../../scripts/lib/publishing-upgrade'

it('requires an actually completed and matching audience-safe deployment as the recovery baseline', () => {
  const evidence = { publishingAudienceSafe: true, deployment: 'deployment', workerVersion: 'version', validationPassed: true,
    livePassed: true, loginVerified: true, healthSeconds: 610, exceptions: 0, serverErrors: 0, source: 'a'.repeat(40), artifactHash: 'b'.repeat(64) }
  const input = { deployment: 'deployment', version: 'version', run: { phase: 'complete', evidence } }
  expect(() => requireAudienceSafeBaseline(input)).not.toThrow()
  for (const changed of [{ publishingAudienceSafe: false }, { deployment: 'older' }, { workerVersion: 'older' }, { healthSeconds: 599 }, { loginVerified: false }, { exceptions: 1 }, { serverErrors: 1 }])
    expect(() => requireAudienceSafeBaseline({ ...input, run: { phase: 'complete', evidence: { ...evidence, ...changed } } })).toThrow('audience-safe')
  expect(() => requireAudienceSafeBaseline({ ...input, run: { phase: 'observing', evidence } })).toThrow('audience-safe')
  expect(() => requireAudienceSafeBaseline({ ...input, run: null })).toThrow('audience-safe')
})
