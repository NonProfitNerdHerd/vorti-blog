import { afterEach, describe, expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import {
  acquireRelease,
  advanceRelease,
  releaseMaintenanceRequired,
  releaseOperationsSchema,
} from '../../scripts/lib/release-lock'

const databases: ReturnType<typeof localD1>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
function fixture() {
  const database = localD1()
  databases.push(database)
  for (const statement of releaseOperationsSchema) database.sqlite.exec(statement)
  return database
}
const input = () => ({
  id: crypto.randomUUID(),
  target: 'vorti-blog',
  mode: 'development-reset' as const,
  baseline: { deployment: 'prior' },
})
describe('durable release coordination', () => {
  it('preserves queued jobs during ordinary upgrades', async () => {
    const { db } = fixture()
    let lease = await acquireRelease(db, { ...input(), mode: 'upgrade' })
    lease = await advanceRelease(db, lease, 'prepared', { validationPassed: true })
    lease = await advanceRelease(db, lease, 'frozen', {})
    const evidence = { writesStopped: true, recoveryVerified: true, queuesStopped: true }
    await expect(
      advanceRelease(db, lease, 'cutover', { ...evidence, queuesPurged: true }),
    ).rejects.toThrow('preserve queued')
    await expect(advanceRelease(db, lease, 'cutover', evidence)).resolves.toMatchObject({
      phase: 'cutover',
    })
  })
  it('blocks competing releases and stale transitions without losing the original lease', async () => {
    const { db } = fixture(),
      lease = await acquireRelease(db, input())
    await expect(acquireRelease(db, input())).rejects.toThrow('UNIQUE')
    const prepared = await advanceRelease(db, lease, 'prepared', { validationPassed: true })
    await expect(advanceRelease(db, lease, 'aborted', {})).rejects.toThrow('CHECK')
    expect(await releaseMaintenanceRequired(db, lease.target)).toBe(false)
    await advanceRelease(db, prepared, 'frozen', {})
    expect(await releaseMaintenanceRequired(db, lease.target)).toBe(true)
  })
  it('retains maintenance during recovery and requires evidence before reopening', async () => {
    const { db } = fixture()
    let lease = await acquireRelease(db, input())
    await expect(advanceRelease(db, lease, 'frozen', {})).rejects.toThrow('transition')
    lease = await advanceRelease(db, lease, 'prepared', { validationPassed: true })
    lease = await advanceRelease(db, lease, 'frozen', {})
    await expect(advanceRelease(db, lease, 'cutover', {})).rejects.toThrow('Cutover requires')
    lease = await advanceRelease(db, lease, 'recovering', {})
    await expect(advanceRelease(db, lease, 'aborted', {})).rejects.toThrow(
      'Recovery must be verified',
    )
    expect(await releaseMaintenanceRequired(db, lease.target)).toBe(true)
    await advanceRelease(db, lease, 'aborted', { recoveryVerified: true })
    expect(await releaseMaintenanceRequired(db, lease.target)).toBe(false)
    await expect(acquireRelease(db, input())).resolves.toMatchObject({ phase: 'preparing' })
  })
  it('prevents premature completion and preserves append-only phase evidence', async () => {
    const { db, sqlite } = fixture()
    let lease = await acquireRelease(db, input())
    lease = await advanceRelease(db, lease, 'prepared', { validationPassed: true })
    lease = await advanceRelease(db, lease, 'frozen', {})
    lease = await advanceRelease(db, lease, 'cutover', {
      writesStopped: true,
      recoveryVerified: true,
      queuesStopped: true,
      queuesPurged: true,
    })
    lease = await advanceRelease(db, lease, 'verifying', {})
    await expect(advanceRelease(db, lease, 'observing', { livePassed: true })).rejects.toThrow(
      'administrator login',
    )
    expect(await releaseMaintenanceRequired(db, lease.target)).toBe(true)
    lease = await advanceRelease(db, lease, 'observing', { livePassed: true, loginVerified: true })
    expect(await releaseMaintenanceRequired(db, lease.target)).toBe(false)
    await expect(advanceRelease(db, lease, 'frozen', {})).rejects.toThrow('corrective cutover')
    lease = await advanceRelease(db, lease, 'frozen', {
      validationPassed: true,
      artifactOnlyCorrection: true,
      resourcesUnchanged: true,
      migrationsUnchanged: true,
      recoveryVerified: true,
    })
    expect(await releaseMaintenanceRequired(db, lease.target)).toBe(true)
    await expect(advanceRelease(db, lease, 'cutover', {})).rejects.toThrow('Cutover requires')
    lease = await advanceRelease(db, lease, 'cutover', {
      writesStopped: true,
      queuesStopped: true,
      queuesPurged: true,
      recoveryVerified: true,
    })
    lease = await advanceRelease(db, lease, 'verifying', {})
    lease = await advanceRelease(db, lease, 'observing', { livePassed: true, loginVerified: true })
    await expect(acquireRelease(db, input())).rejects.toThrow('UNIQUE')
    await expect(
      advanceRelease(db, lease, 'complete', {
        validationPassed: true,
        livePassed: true,
        healthSeconds: 599,
        exceptions: 0,
        serverErrors: 0,
      }),
    ).rejects.toThrow('incomplete')
    await advanceRelease(db, lease, 'complete', {
      validationPassed: true,
      livePassed: true,
      healthSeconds: 600,
      exceptions: 0,
      serverErrors: 0,
    })
    expect(await releaseMaintenanceRequired(db, lease.target)).toBe(false)
    expect(() => sqlite.exec('DELETE FROM release_events')).toThrow('append-only')
    expect(sqlite.prepare('SELECT count(*) AS n FROM release_events').get()?.n).toBe(11)
  })
  it('records an explicitly superseded preview release without claiming health passed', async () => {
    const { db, sqlite } = fixture()
    let lease = await acquireRelease(db, { ...input(), mode: 'upgrade' })
    lease = await advanceRelease(db, lease, 'prepared', { validationPassed: true })
    lease = await advanceRelease(db, lease, 'frozen', {})
    lease = await advanceRelease(db, lease, 'cutover', {
      writesStopped: true, recoveryVerified: true, queuesStopped: true,
    })
    lease = await advanceRelease(db, lease, 'verifying', {})
    lease = await advanceRelease(db, lease, 'observing', { livePassed: true, loginVerified: true })
    const evidence = {
      outcome: 'superseded-preview',
      userAuthorizedIncompleteRelease: true,
      maintenanceInactive: true,
      databaseWriteFenceAbsent: true,
      operationalWriteGuardsAbsent: true,
      queueConsumerActive: true,
      blockedExternalEffectsAbsent: true,
      migrationLedgerCurrent: true,
      resourcesUnchanged: true,
      currentSource: 'b88ef0f8c558b38bee233a7f8114d9e5c8b9febb',
      currentDeployment: '3477278a-7a26-48e0-b5b8-5430c1d29f57',
      currentVersion: '69fa64d2-1948-44ba-b01a-25329d4f1d21',
      reason: 'The user chose focused preview validation while development continues.',
    }
    await expect(advanceRelease(db, lease, 'aborted', { ...evidence, queueConsumerActive: false }))
      .rejects.toThrow('Superseding')
    await expect(acquireRelease(db, input())).rejects.toThrow('UNIQUE')
    lease = await advanceRelease(db, lease, 'aborted', evidence)
    expect(lease.phase).toBe('aborted')
    expect(sqlite.prepare('SELECT phase FROM release_runs WHERE id=?').get(lease.id)?.phase).toBe('aborted')
    const final = sqlite.prepare('SELECT evidence FROM release_events WHERE run_id=? AND revision=?')
      .get(lease.id, lease.revision) as { evidence: string }
    expect(JSON.parse(final.evidence)).toMatchObject(evidence)
    await expect(acquireRelease(db, input())).resolves.toMatchObject({ phase: 'preparing' })
  })
})
