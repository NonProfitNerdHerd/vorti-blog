import { registerHooks } from 'node:module'
import path from 'node:path'

const state = process.env.DESIGN_CORE_TEST_PERSIST_PATH
if (
  !state ||
  !path.isAbsolute(state) ||
  process.env.DESIGN_PRODUCTION_DEPLOY ||
  process.env.DESIGN_PRODUCTION_MIGRATE
)
  throw Error(
    'The Node fixture loader requires explicit local persistence and no production intent.',
  )

// Next handles this compile-time marker. Direct Node fixture tools use the same
// empty marker as Vitest; application authorization remains fully active.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'server-only'
      ? { url: new URL('./server-only.ts', import.meta.url).href, shortCircuit: true }
      : nextResolve(specifier, context)
  },
})
