import { expect, it } from 'vitest'
import { assertUpgradeState } from '../../scripts/lib/upgrade-state'

const fixture = () => ({
  lease: { id: 'upgrade-123456789', target: 'vorti-blog', phase: 'frozen' as const, revision: 3 },
  actual: { id: 'upgrade-123456789', target: 'vorti-blog', phase: 'frozen', revision: 3, mode: 'upgrade' },
  action: 'migrate' as const, applicationID: 'application', operationsID: 'operations', baselineApplicationID: 'application',
  recoveryVerified: true, artifactVerified: true,
})
it('permits only a current protected upgrade against its preserved database', () => {
  expect(() => assertUpgradeState(fixture())).not.toThrow()
  expect(() => assertUpgradeState({ ...fixture(), action: 'verify-schema' })).not.toThrow()
  expect(() => assertUpgradeState({ ...fixture(), lease: { ...fixture().lease, phase: 'verifying' }, actual: { ...fixture().actual, phase: 'verifying' }, action: 'verification-thaw' })).not.toThrow()
  for (const patch of [
    { actual: null }, { actual: { ...fixture().actual, mode: 'development-reset' } },
    { actual: { ...fixture().actual, revision: 4 } }, { applicationID: 'replacement' },
    { operationsID: 'application' }, { recoveryVerified: false }, { artifactVerified: false },
  ]) expect(() => assertUpgradeState({ ...fixture(), ...patch })).toThrow()
})
it('rejects unprotected states and thawing before a deployed verification phase', () => {
  for (const phase of ['preparing', 'prepared', 'cutover', 'observing', 'recovering', 'complete'] as const)
    expect(() => assertUpgradeState({ ...fixture(), lease: { ...fixture().lease, phase }, actual: { ...fixture().actual, phase } })).toThrow()
  expect(() => assertUpgradeState({ ...fixture(), action: 'verification-thaw' })).toThrow()
  expect(() => assertUpgradeState({ ...fixture(), action: 'verify-schema', lease: { ...fixture().lease, phase: 'verifying' }, actual: { ...fixture().actual, phase: 'verifying' } })).toThrow()
})
