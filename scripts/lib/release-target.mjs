const modes = new Set(['install', 'upgrade', 'development-reset'])
const applicationBindings = new Map([
  ['D1', 'd1'],
  ['R2', 'r2_bucket'],
  ['WORKSPACE_FILES', 'r2_bucket'],
])
const resourceIdentity = (resource) =>
  `${resource.type}:${resource.type === 'd1' ? resource.id : resource.name}`

/** Validate intent before any remote provisioning or destructive operation. */
export function validateReleaseTarget({
  mode,
  discardDevelopmentData,
  expectedWorker,
  baseline,
  replacement,
}) {
  if (!modes.has(mode)) throw Error('Choose install, upgrade, or development-reset.')
  if (
    !expectedWorker ||
    baseline.worker !== expectedWorker ||
    replacement.worker !== expectedWorker
  )
    throw Error('Release target identity mismatch.')
  if (mode === 'development-reset' && discardDevelopmentData !== true)
    throw Error('development-reset requires explicit --discard-development-data.')
  if (mode !== 'development-reset' && discardDevelopmentData)
    throw Error('Data disposal is only allowed in development-reset mode.')
  const select = (snapshot) => {
    const selected = snapshot.resources.filter((resource) =>
      applicationBindings.has(resource.binding),
    )
    if (
      selected.length !== applicationBindings.size ||
      new Set(selected.map((resource) => resource.binding)).size !== selected.length
    )
      throw Error('Application resource inventory is incomplete or ambiguous.')
    for (const resource of selected) {
      if (
        applicationBindings.get(resource.binding) !== resource.type ||
        (resource.type === 'd1' &&
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
            resource.id || '',
          )) ||
        (resource.type === 'r2_bucket' &&
          !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(resource.name || ''))
      )
        throw Error('Invalid application resource identity.')
    }
    if (new Set(selected.map(resourceIdentity)).size !== selected.length)
      throw Error('Application resource bindings must be distinct.')
    return selected
  }
  const next = select(replacement)
  if (mode === 'install') {
    if (baseline.deployment || baseline.resources.length)
      throw Error('install requires an unused target; use upgrade or explicit development-reset.')
    return { cleanup: [] }
  }
  if (!baseline.deployment || !baseline.version)
    throw Error('An active recovery baseline is required.')
  for (const resource of baseline.resources.filter(
    (item) => !applicationBindings.has(item.binding),
  )) {
    const retained = replacement.resources.find((item) => item.binding === resource.binding)
    if (!retained || resourceIdentity(resource) !== resourceIdentity(retained))
      throw Error('Operational and unrelated resource bindings must be preserved.')
  }
  const previous = select(baseline)
  if (mode === 'upgrade') {
    if (
      previous.some(
        (resource) =>
          resourceIdentity(resource) !==
          resourceIdentity(next.find((item) => item.binding === resource.binding)),
      )
    )
      throw Error('Ordinary upgrades must preserve application resource bindings.')
    return { cleanup: [] }
  }
  const previousIdentities = new Set(baseline.resources.map(resourceIdentity))
  if (next.some((resource) => previousIdentities.has(resourceIdentity(resource))))
    throw Error(
      'development-reset requires fresh application resources; existing resources cannot be reused.',
    )
  return { cleanup: previous }
}

/** Compare identities, not timestamps or a presumed older version. */
export function assertUnchangedBaseline(expected, current) {
  for (const key of [
    'worker',
    'deployment',
    'version',
    'remoteMain',
    'migrationLedgerHash',
    'configurationHash',
  ])
    if (!expected[key] || expected[key] !== current[key])
      throw Error(
        `Release baseline advanced or changed: ${key}. Reconcile and revalidate before cutover.`,
      )
  const inventory = (value) =>
    value.resources.map((resource) => `${resource.binding}:${resourceIdentity(resource)}`).sort()
  if (JSON.stringify(inventory(expected)) !== JSON.stringify(inventory(current)))
    throw Error('Release resource bindings changed before cutover.')
}

export function approvedCleanupTargets(input, verification) {
  const { cleanup } = validateReleaseTarget(input)
  if (input.mode !== 'development-reset') return []
  if (
    !verification ||
    verification.deployment !== input.replacement.deployment ||
    !verification.deployment ||
    verification.workerVersion !== input.replacement.version ||
    !verification.workerVersion ||
    verification.publicPassed !== true ||
    verification.authenticatedPassed !== true ||
    verification.adminLoginPassed !== true ||
    verification.emptyInstallationPassed !== true ||
    verification.healthSeconds < 600 ||
    !Number.isFinite(verification.healthSeconds) ||
    verification.serverErrors !== 0 ||
    verification.exceptions !== 0
  )
    throw Error(
      'Cleanup requires successful verification and ten minutes of healthy observation of the replacement deployment.',
    )
  return cleanup
}
