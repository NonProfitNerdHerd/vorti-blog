const kind = process.argv[2]
const flag = kind === 'migration' ? 'DESIGN_PRODUCTION_MIGRATE' : kind === 'deployment' ? 'DESIGN_PRODUCTION_DEPLOY' : null
if (!flag || process.env[flag] !== 'YES') throw new Error(`Explicit ${flag ?? 'production'}=YES is required for this production action.`)
if (process.env.DESIGN_CORE_TEST_PERSIST_PATH) throw new Error('Production actions cannot use DESIGN_CORE_TEST_PERSIST_PATH.')
if (kind === 'migration' && !process.env.DESIGN_ADMIN_EMAIL?.trim()) throw new Error('DESIGN_ADMIN_EMAIL must be configured before production migration.')
