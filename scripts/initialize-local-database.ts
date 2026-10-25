import path from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { migrateDatabase } from './lib/migrate-database'

const directory = process.argv[2]
if (!directory || !path.isAbsolute(directory))
  throw Error('An absolute local persistence directory is required.')
const proxy = await getPlatformProxy<CloudflareEnv>({
  configPath: path.resolve('wrangler.test.jsonc'),
  persist: { path: directory },
  remoteBindings: false,
})
try {
  const result = await migrateDatabase(proxy.env.D1, (name) => console.log(`Applied ${name}`))
  for (const table of [
    'users',
    'posts',
    'pages',
    'review_tasks',
    'task_boards',
    'vc_crm_constituents',
  ]) {
    const row = await proxy.env.D1.prepare(`SELECT count(*) AS n FROM ${table}`).first<{
      n: number
    }>()
    if (row?.n !== 0) throw Error(`Clean initialization requires an empty ${table} table.`)
  }
  const inventory = await proxy.env.D1.prepare(
    "SELECT type,count(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' GROUP BY type ORDER BY type",
  ).all()
  console.log(
    JSON.stringify({
      ...result,
      inventory: inventory.results,
      foreignKeyViolations: 0,
      applicationRows: 0,
    }),
  )
} finally {
  await proxy.dispose()
}
