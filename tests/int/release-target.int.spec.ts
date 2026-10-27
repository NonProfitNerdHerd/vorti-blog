import { describe, expect, it } from 'vitest'
import {
  approvedCleanupTargets,
  assertUnchangedBaseline,
  validateReleaseTarget,
} from '../../scripts/lib/release-target.mjs'

const baseline = {
  worker: 'vorti-blog',
  deployment: 'old-deployment',
  version: 'old-version',
  remoteMain: 'source',
  migrationLedgerHash: 'ledger',
  configurationHash: 'config',
  resources: [
    { binding: 'D1', type: 'd1', id: '00000000-0000-4000-8000-000000000001' },
    { binding: 'R2', type: 'r2_bucket', name: 'old-public' },
    { binding: 'WORKSPACE_FILES', type: 'r2_bucket', name: 'old-private' },
    { binding: 'OPERATIONS', type: 'd1', id: '00000000-0000-4000-8000-000000000009' },
    { binding: 'UNRELATED', type: 'r2_bucket', name: 'unrelated' },
  ],
}
const replacement = {
  ...baseline,
  deployment: 'new-deployment',
  version: 'new-version',
  resources: [
    { binding: 'D1', type: 'd1', id: '00000000-0000-4000-8000-000000000002' },
    { binding: 'R2', type: 'r2_bucket', name: 'new-public' },
    { binding: 'WORKSPACE_FILES', type: 'r2_bucket', name: 'new-private' },
    ...baseline.resources.slice(3),
  ],
}
const reset = {
  mode: 'development-reset',
  discardDevelopmentData: true,
  expectedWorker: 'vorti-blog',
  baseline,
  replacement,
}
describe('release mode and cleanup targeting', () => {
  it('requires explicit reset mode and refuses ordinary upgrade rebinding', () => {
    expect(() => validateReleaseTarget({ ...reset, discardDevelopmentData: false })).toThrow(
      'explicit',
    )
    expect(() => validateReleaseTarget({ ...reset, mode: 'upgrade' })).toThrow('only allowed')
    expect(() =>
      validateReleaseTarget({ ...reset, mode: 'upgrade', discardDevelopmentData: false }),
    ).toThrow('preserve')
    expect(
      validateReleaseTarget({
        ...reset,
        mode: 'upgrade',
        discardDevelopmentData: false,
        replacement: baseline,
      }),
    ).toEqual({ cleanup: [] })
  })
  it('rejects wrong targets, ambiguous bindings, and reuse of any existing resource', () => {
    expect(() => validateReleaseTarget({ ...reset, expectedWorker: 'other' })).toThrow('identity')
    expect(() =>
      validateReleaseTarget({
        ...reset,
        replacement: {
          ...replacement,
          resources: [...replacement.resources, replacement.resources[0]],
        },
      }),
    ).toThrow('ambiguous')
    for (const oldResource of baseline.resources.filter((resource) => resource.type === 'd1')) {
      expect(() =>
        validateReleaseTarget({
          ...reset,
          replacement: {
            ...replacement,
            resources: [{ ...oldResource, binding: 'D1' }, ...replacement.resources.slice(1)],
          },
        }),
      ).toThrow('fresh')
    }
  })
  it('limits cleanup to the three inventoried application bindings after complete verification', () => {
    const verification = {
      deployment: replacement.deployment,
      workerVersion: replacement.version,
      publicPassed: true,
      authenticatedPassed: true,
      adminLoginPassed: true,
      emptyInstallationPassed: true,
      healthSeconds: 600,
      serverErrors: 0,
      exceptions: 0,
    }
    expect(
      approvedCleanupTargets(reset, verification).map(
        (resource: { binding: string }) => resource.binding,
      ),
    ).toEqual(['D1', 'R2', 'WORKSPACE_FILES'])
    for (const change of [
      { healthSeconds: 599 },
      { healthSeconds: NaN },
      { deployment: baseline.deployment },
      { serverErrors: 1 },
      { adminLoginPassed: false },
    ])
      expect(() => approvedCleanupTargets(reset, { ...verification, ...change })).toThrow(
        'Cleanup requires',
      )
  })
  it('blocks intervening source, migration, deployment and binding changes', () => {
    expect(() => assertUnchangedBaseline(baseline, structuredClone(baseline))).not.toThrow()
    for (const key of [
      'worker',
      'deployment',
      'version',
      'remoteMain',
      'migrationLedgerHash',
      'configurationHash',
    ])
      expect(() => assertUnchangedBaseline(baseline, { ...baseline, [key]: 'changed' })).toThrow(
        'changed',
      )
    expect(() =>
      assertUnchangedBaseline(baseline, { ...baseline, resources: replacement.resources }),
    ).toThrow('bindings changed')
  })
})
