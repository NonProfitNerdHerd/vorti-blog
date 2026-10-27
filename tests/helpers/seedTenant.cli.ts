import path from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { migrateDatabase } from '../../scripts/lib/migrate-database'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'

const persist = process.env.DESIGN_CORE_TEST_PERSIST_PATH
if (!persist || !path.isAbsolute(persist) || !persist.includes('.wrangler') || process.env.DESIGN_PRODUCTION_DEPLOY || process.env.DESIGN_PRODUCTION_MIGRATE) throw Error('An isolated local tenant fixture is required.')
const proxy = await getPlatformProxy<CloudflareEnv>({ configPath: path.resolve('wrangler.test.jsonc'), remoteBindings: false, persist: {path:persist} })
try {
  await migrateDatabase(proxy.env.D1)
  if ((await proxy.env.D1.prepare('SELECT count(*) n FROM users').first<{n:number}>())?.n !== 0) throw Error('Refusing to reuse a populated tenant fixture.')
} finally { await proxy.dispose() }
const { getPayload } = await import('payload')
const { default: config } = await import('../../src/payload.config')
const { bootstrapFixtureOperator } = await import('./native-authority')
const payload = await getPayload({config})
await bootstrapFixtureOperator(payload)
const db = (payload.db as unknown as {client:D1Database}).client
await bootstrapTenant(db,{tenant:'default',site:'default',administratorEmail:'dev@payloadcms.com'})
await activateTenantAuthority(db,'default')
console.log('Isolated tenant fixture activated with fictional administrator credentials.')
process.exit(0)
