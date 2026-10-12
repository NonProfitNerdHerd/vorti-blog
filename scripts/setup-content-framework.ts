import { getPayload } from 'payload'
import { setupContentFramework } from '../src/content-framework/setup'

// Run with: payload run scripts/setup-content-framework.ts [demonstrations]
if (!process.env.DESIGN_CORE_TEST_PERSIST_PATH && process.env.DESIGN_PRODUCTION_MIGRATE !== 'YES')
  throw new Error('Explicit production migration intent or isolated local persistence is required')
if (!process.env.DESIGN_ADMIN_EMAIL)
  throw new Error('DESIGN_ADMIN_EMAIL must identify an existing administrator')
// The Worker enables this via its binding; CLI scripts need the equivalent process setting.
process.env.CONTENT_WORKSPACE_ENABLED = 'true'
const { default: config } = await import('../src/payload.config')
const payload = await getPayload({ config })
try {
  const users = await payload.find({
    collection: 'users',
    where: {
      and: [
        { email: { equals: process.env.DESIGN_ADMIN_EMAIL } },
        { role: { equals: 'administrator' } },
      ],
    },
    limit: 1,
  })
  if (!users.docs[0]) throw new Error('Existing administrator not found')
  console.log(
    JSON.stringify(
      await setupContentFramework(
        payload,
        users.docs[0].id,
        process.argv.includes('--demonstrations') || process.argv.includes('demonstrations'),
      ),
    ),
  )
} finally {
  await payload.destroy()
}
process.exit(0)
