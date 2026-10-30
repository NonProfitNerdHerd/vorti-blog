/** Stored in a separate operational database, never in the replaceable application D1. */
export const releaseOperationsSchema = [
  `CREATE TABLE IF NOT EXISTS release_runs (
    id TEXT PRIMARY KEY NOT NULL, target TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN('install','upgrade','development-reset')),
    phase TEXT NOT NULL CHECK(phase IN('preparing','prepared','frozen','cutover','verifying','observing','recovering','complete','aborted')),
    revision INTEGER NOT NULL DEFAULT 1, baseline TEXT NOT NULL CHECK(json_valid(baseline)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS release_active_target ON release_runs(target) WHERE phase NOT IN('complete','aborted')`,
  `CREATE TABLE IF NOT EXISTS release_events (
    id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES release_runs(id), revision INTEGER NOT NULL,
    phase TEXT NOT NULL, evidence TEXT NOT NULL CHECK(json_valid(evidence)), created_at TEXT NOT NULL,
    UNIQUE(run_id,revision)
  )`,
  `CREATE TRIGGER IF NOT EXISTS release_events_immutable_update BEFORE UPDATE ON release_events BEGIN SELECT RAISE(ABORT,'Release evidence is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS release_events_immutable_delete BEFORE DELETE ON release_events BEGIN SELECT RAISE(ABORT,'Release evidence is append-only'); END`,
  `CREATE TABLE IF NOT EXISTS release_write_guards(id TEXT PRIMARY KEY, affected INTEGER NOT NULL CHECK(affected=1))`,
  `CREATE TABLE IF NOT EXISTS release_external_effects(provider TEXT NOT NULL,reference_hash TEXT NOT NULL,release_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'blocked' CHECK(state IN('blocked','reconciled')),created_at TEXT NOT NULL,PRIMARY KEY(provider,reference_hash))`,
  `CREATE TABLE IF NOT EXISTS release_external_events(provider TEXT NOT NULL,event_hash TEXT NOT NULL,reference_hash TEXT NOT NULL,body_hash TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(provider,event_hash))`,
  `CREATE TABLE IF NOT EXISTS release_external_reconciliations(id TEXT PRIMARY KEY,release_id TEXT NOT NULL,provider TEXT NOT NULL,reference_hash TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN('completed','not-completed','cancelled')),evidence_hash TEXT NOT NULL,created_at TEXT NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS release_reconciliation_immutable_update BEFORE UPDATE ON release_external_reconciliations BEGIN SELECT RAISE(ABORT,'Reconciliation evidence is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS release_reconciliation_immutable_delete BEFORE DELETE ON release_external_reconciliations BEGIN SELECT RAISE(ABORT,'Reconciliation evidence is append-only'); END`,
] as const

export type ReleasePhase =
  | 'preparing'
  | 'prepared'
  | 'frozen'
  | 'cutover'
  | 'verifying'
  | 'observing'
  | 'recovering'
  | 'complete'
  | 'aborted'
const transitions: Record<ReleasePhase, ReleasePhase[]> = {
  preparing: ['prepared', 'aborted'],
  prepared: ['frozen', 'aborted'],
  frozen: ['cutover', 'recovering'],
  cutover: ['verifying', 'recovering'],
  verifying: ['observing', 'recovering'],
  observing: ['complete', 'recovering', 'frozen', 'aborted'],
  recovering: ['aborted'],
  complete: [],
  aborted: [],
}
export type ReleaseLease = { id: string; target: string; phase: ReleasePhase; revision: number }

/** Leases never expire into automatic takeover: an interrupted cutover needs reconciliation. */
export async function acquireRelease(
  db: D1Database,
  input: {
    id: string
    target: string
    mode: 'install' | 'upgrade' | 'development-reset'
    baseline: object
  },
): Promise<ReleaseLease> {
  if (!/^[a-z0-9-]{16,80}$/.test(input.id) || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.target))
    throw Error('Invalid release identity.')
  const now = new Date().toISOString()
  await db.batch([
    db
      .prepare(
        "INSERT INTO release_runs(id,target,mode,phase,baseline,created_at,updated_at) VALUES(?,?,?,'preparing',?,?,?)",
      )
      .bind(input.id, input.target, input.mode, JSON.stringify(input.baseline), now, now),
    db
      .prepare(
        "INSERT INTO release_events(run_id,revision,phase,evidence,created_at) VALUES(?,1,'preparing','{}',?)",
      )
      .bind(input.id, now),
  ])
  return { id: input.id, target: input.target, phase: 'preparing', revision: 1 }
}

export async function advanceRelease(
  db: D1Database,
  lease: ReleaseLease,
  phase: ReleasePhase,
  evidence: Record<string, unknown>,
): Promise<ReleaseLease> {
  if (!transitions[lease.phase]?.includes(phase)) throw Error('Invalid release phase transition.')
  const run = await db
    .prepare('SELECT mode FROM release_runs WHERE id=? AND target=?')
    .bind(lease.id, lease.target)
    .first<{ mode: string }>()
  if (!run) throw Error('Release lease is unavailable.')
  if (
    lease.phase === 'observing' &&
    phase === 'frozen' &&
    (evidence.validationPassed !== true ||
      evidence.artifactOnlyCorrection !== true ||
      evidence.resourcesUnchanged !== true ||
      evidence.migrationsUnchanged !== true ||
      evidence.recoveryVerified !== true)
  )
    throw Error(
      'A corrective cutover requires validated code, unchanged resources and migrations, and retained recovery.',
    )
  const explicitlyWaived = evidence.validationWaived === true && evidence.userAuthorizedIncompleteRelease === true &&
    /^[a-f0-9]{64}$/.test(String(evidence.validationWaiverHash || '')) && /^[a-f0-9]{40}$/.test(String(evidence.source || '')) &&
    typeof evidence.reason === 'string' && evidence.reason.trim().length > 0
  if (phase === 'prepared' && evidence.validationPassed !== true && !explicitlyWaived)
    throw Error('Passing validation is required before preparation completes.')
  if (
    phase === 'cutover' &&
    (evidence.writesStopped !== true ||
      evidence.recoveryVerified !== true ||
      evidence.queuesStopped !== true ||
      (run.mode === 'development-reset' && evidence.queuesPurged !== true))
  )
    throw Error('Cutover requires stopped writes, verified recovery and reconciled queues.')
  if (run.mode === 'upgrade' && evidence.queuesPurged === true)
    throw Error('Ordinary upgrades must preserve queued application jobs.')
  if (phase === 'observing' && (evidence.livePassed !== true || evidence.loginVerified !== true))
    throw Error('Live checks and administrator login must pass before reopening access.')
  if (
    phase === 'complete' &&
    (evidence.validationPassed !== true ||
      evidence.livePassed !== true ||
      typeof evidence.healthSeconds !== 'number' ||
      !Number.isFinite(evidence.healthSeconds) ||
      evidence.healthSeconds < 600 ||
      evidence.exceptions !== 0 ||
      evidence.serverErrors !== 0)
  )
    throw Error('Release verification is incomplete.')
  if (lease.phase === 'recovering' && phase === 'aborted' && evidence.recoveryVerified !== true)
    throw Error('Recovery must be verified before maintenance protection is removed.')
  if (
    lease.phase === 'observing' &&
    phase === 'aborted' &&
    (evidence.outcome !== 'superseded-preview' ||
      evidence.userAuthorizedIncompleteRelease !== true ||
      evidence.maintenanceInactive !== true ||
      evidence.databaseWriteFenceAbsent !== true ||
      evidence.operationalWriteGuardsAbsent !== true ||
      evidence.queueConsumerActive !== true ||
      evidence.blockedExternalEffectsAbsent !== true ||
      evidence.migrationLedgerCurrent !== true ||
      evidence.resourcesUnchanged !== true ||
      !/^[a-f0-9]{40}$/.test(String(evidence.currentSource || '')) ||
      !/^[a-f0-9-]{36}$/.test(String(evidence.currentDeployment || '')) ||
      !/^[a-f0-9-]{36}$/.test(String(evidence.currentVersion || '')) ||
      typeof evidence.reason !== 'string' ||
      !evidence.reason.trim())
  )
    throw Error('Superseding an observed preview release requires current deployment, data, queue, and operator evidence.')
  const guard = crypto.randomUUID(),
    now = new Date().toISOString()
  await db.batch([
    db
      .prepare(
        'UPDATE release_runs SET phase=?,revision=revision+1,updated_at=? WHERE id=? AND target=? AND revision=? AND phase=?',
      )
      .bind(phase, now, lease.id, lease.target, lease.revision, lease.phase),
    db.prepare('INSERT INTO release_write_guards(id,affected) VALUES(?,changes())').bind(guard),
    db
      .prepare(
        'INSERT INTO release_events(run_id,revision,phase,evidence,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(lease.id, lease.revision + 1, phase, JSON.stringify(evidence), now),
    db.prepare('DELETE FROM release_write_guards WHERE id=?').bind(guard),
  ])
  return { ...lease, revision: lease.revision + 1, phase }
}

export async function releaseMaintenanceRequired(db: D1Database, target: string): Promise<boolean> {
  const run = await db
    .prepare("SELECT phase FROM release_runs WHERE target=? AND phase NOT IN('complete','aborted')")
    .bind(target)
    .first<{ phase: ReleasePhase }>()
  return !!run && ['frozen', 'cutover', 'verifying', 'recovering'].includes(run.phase)
}
