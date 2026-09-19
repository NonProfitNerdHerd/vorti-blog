import path from 'node:path'

const state = process.env.DESIGN_CORE_TEST_PERSIST_PATH
if (process.platform !== 'linux' || !state || !path.isAbsolute(state) || state.startsWith('/mnt/')) {
  throw new Error('Local Worker builds require DESIGN_CORE_TEST_PERSIST_PATH at a native Linux absolute path.')
}
if (process.env.DESIGN_PRODUCTION_MIGRATE === 'YES' || process.env.DESIGN_PRODUCTION_DEPLOY === 'YES') {
  throw new Error('Local Worker builds cannot run with production intent flags.')
}
