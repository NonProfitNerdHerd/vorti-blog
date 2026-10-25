import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const files = readdirSync('tests/int').filter((file) => /\.int\.spec\.(ts|tsx)$/.test(file))
const native = files.filter((file) =>
  readFileSync(`tests/int/${file}`, 'utf8').includes("from '@/payload.config'"),
)
const dom = files.filter((file) =>
  readFileSync(`tests/int/${file}`, 'utf8').includes(
    'DOM environment is selected by the dom Vitest project.',
  ),
)
const fixtureRun = `${Date.now()}-${process.pid}`

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  // Next handles this build-time marker; repository tests run directly in Node.
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./tests/helpers/server-only.ts', import.meta.url)),
    },
  },
  test: {
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 120000,
    environment: 'node',
    env: { PAYLOAD_SECRET: 'local-validation-only-secret' },
    setupFiles: ['./vitest.setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['tests/int/**/*.int.spec.{ts,tsx}'],
          exclude: [...native, ...dom].map((file) => `tests/int/${file}`),
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: './tests/helpers/node-dom-environment.ts',
          include: dom.map((file) => `tests/int/${file}`),
        },
      },
      ...native.map((file) => {
        const fixture = path.resolve(
          '.wrangler',
          `native-validation-${fixtureRun}`,
          `crm-task-native-bridge-${file}`,
          'v3',
        )
        return {
          extends: true as const,
          test: {
            name: `native:${file.replace('.int.spec.ts', '')}`,
            include: [`tests/int/${file}`],
            globalSetup: ['./tests/helpers/native-global-setup.ts'],
            setupFiles: ['./tests/helpers/native-setup.ts'],
            env: {
              PAYLOAD_SECRET: 'local-validation-only-secret',
              DESIGN_CORE_TEST_PERSIST_PATH: fixture,
              E2E_TEST_PERSIST_PATH: fixture,
              NATIVE_TEST_BASE: path.resolve(
                '.wrangler',
                `native-validation-${fixtureRun}`,
                'clean-baseline',
                'v3',
              ),
            },
          },
        }
      }),
    ],
  },
})
