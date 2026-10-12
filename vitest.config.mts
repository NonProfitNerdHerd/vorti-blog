import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
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
