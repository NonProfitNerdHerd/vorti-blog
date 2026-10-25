import 'dotenv/config'
import path from 'node:path'
import { cpSync, existsSync } from 'node:fs'
import { getPayload } from 'payload'
import { bootstrapFixtureOperator } from './native-authority'
import { beforeAll, vi } from 'vitest'

// These suites run real Payload/D1, outside a Next rendering request. Cache
// invalidation itself is exercised by the built-Worker browser regressions.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const directory = process.env.DESIGN_CORE_TEST_PERSIST_PATH
if (!directory || !directory.includes('native-validation-'))
  throw Error('An isolated native fixture is required.')
const baseline = process.env.NATIVE_TEST_BASE
if (!baseline || !existsSync(path.join(baseline, 'clean-baseline.ready')) || existsSync(directory))
  throw Error('A new fixture and a freshly migrated, closed baseline are required.')
// The initializer has exited and closed workerd before copying. No mutable
// database is shared between suites, and no legacy populated state is reused.
cpSync(baseline, directory, { recursive: true })
// Test-module mocks (for example Next cache invalidation without a Next request)
// must be installed before loading the application config and its hook closures.
beforeAll(async () => {
  const { default: config } = await import('../../src/payload.config')
  await bootstrapFixtureOperator(await getPayload({ config }))
})
