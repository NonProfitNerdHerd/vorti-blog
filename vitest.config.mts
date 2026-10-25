import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath } from 'node:url'

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
    include: ['tests/int/**/*.int.spec.{ts,tsx}'],
  },
})
