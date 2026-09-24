import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const state = resolve('.wrangler/playwright')
rmSync(state, { recursive: true, force: true })

const env = {
  ...process.env,
  E2E_TEST_PERSIST_PATH: state,
  DESIGN_CORE_TEST_PERSIST_PATH: '',
  PAYLOAD_SECRET: process.env.PAYLOAD_SECRET || 'local-validation-only-secret',
}

const forwarded = process.argv.slice(2).filter((argument, index) => argument !== '--' || index > 0)
for (const args of [['playwright', 'test', '--config=playwright.config.ts', ...forwarded]]) {
  const result = spawnSync('pnpm', args, { env, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
