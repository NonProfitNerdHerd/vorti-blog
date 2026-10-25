import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { TestProject } from 'vitest/node'

let preparation: Promise<void> | undefined
export default async function prepareNativeBaseline(project: TestProject) {
  const directory = project.config.env.NATIVE_TEST_BASE
  if (!directory || !directory.includes('native-validation-'))
    throw Error('Missing isolated native baseline.')
  // Shared only within this invocation. It is built from an empty database by
  // executing every registered migration, and contains no workflow fixtures.
  preparation ??= (async () => {
    if (existsSync(path.join(directory, 'clean-baseline.ready'))) return
    if (existsSync(directory)) throw Error('Refusing to reuse an older native baseline.')
    mkdirSync(path.dirname(directory), { recursive: true })
    const result = await promisify(execFile)(
      process.execPath,
      ['--import=tsx/esm', 'scripts/initialize-local-database.ts', directory],
      {
        cwd: process.cwd(),
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        maxBuffer: 8 * 1024 * 1024,
      },
    )
    writeFileSync(path.join(directory, 'migration-output.log'), result.stdout + result.stderr)
    writeFileSync(
      path.join(directory, 'clean-baseline.ready'),
      'registered migrations executed; no application fixtures\n',
    )
  })()
  await preparation
}
