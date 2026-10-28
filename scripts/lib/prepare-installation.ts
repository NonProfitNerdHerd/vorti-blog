import { randomBytes, pbkdf2Sync } from 'node:crypto'
import { migrateDatabase } from './migrate-database'
import { bootstrapTenant, activateTenantAuthority } from './bootstrap-tenant'
import { seedPublishingPortals } from '../../src/publishing/portal-seed'

export type InstallationMode = 'install' | 'upgrade' | 'development-reset'
type Identity = {
  id: number
  email: string
  salt: string
  hash: string
  username?: string
  display_name?: string
  slug?: string
}

/** Read only the authentication identity. Content, sessions, password reset tokens,
 * memberships, old grants, jobs and integration state are deliberately excluded. */
export async function administratorIdentity(source: D1Database, email: string): Promise<Identity> {
  const rows = await source
    .prepare(
      `SELECT u.id,u.email,u.salt,u.hash,u.username,u.display_name,u.slug FROM users u
    WHERE lower(trim(u.email))=? AND NOT EXISTS(SELECT 1 FROM vc_account_status s WHERE s.user_id=u.id AND s.disabled=1)`,
    )
    .bind(email.trim().toLowerCase())
    .all<Identity>()
  if (rows.results.length !== 1 || !rows.results[0].salt || !rows.results[0].hash)
    throw Error('Exactly one active password account must match the bootstrap identity.')
  return rows.results[0]
}

export async function prepareInstallation(
  database: D1Database,
  input: {
    mode: InstallationMode
    administratorEmail?: string
    password?: string
    identity?: Identity
    discardDevelopmentData?: boolean
  },
  onApplied?: (name: string) => void,
) {
  if (!['install', 'upgrade', 'development-reset'].includes(input.mode))
    throw Error('Choose a supported installation mode.')
  if (input.mode === 'development-reset' && !input.discardDevelopmentData)
    throw Error('Explicit development-data disposal is required.')
  if (input.mode !== 'development-reset' && input.discardDevelopmentData)
    throw Error('Only development-reset permits disposal.')
  if (input.mode === 'upgrade' && (input.identity || input.password))
    throw Error('Upgrades never replace credentials.')
  const exists = await database
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payload_migrations'")
    .first()
  if (input.mode !== 'upgrade' && exists)
    throw Error('Fresh installation and reset preparation require an empty replacement database.')
  if (input.mode === 'upgrade' && !exists) throw Error('Use install for an empty database.')
  const email = input.administratorEmail?.trim().toLowerCase()
  if (input.mode !== 'upgrade' && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    throw Error('Provide a valid bootstrap email.')
  if (
    input.mode === 'install' &&
    (!input.password || input.password.length < 12 || input.password.length > 128 || input.identity)
  )
    throw Error(
      'A new installation requires a password from 12 to 128 characters, supplied through the environment.',
    )
  if (
    input.mode === 'development-reset' &&
    (!input.identity || input.identity.email.trim().toLowerCase() !== email || input.password)
  )
    throw Error('Reset must retain the matching administrator credentials.')
  const migration = await migrateDatabase(database, onApplied)
  if (input.mode === 'upgrade') return { mode: input.mode, ...migration, dataPreserved: true }
  const salt = input.identity?.salt || randomBytes(32).toString('hex')
  const identity = input.identity || {
    id: 1,
    username: 'administrator',
    slug: 'administrator',
    email: email!,
    salt,
    hash: pbkdf2Sync(input.password!, salt, 25000, 512, 'sha256').toString('hex'),
  }
  const now = new Date().toISOString(),
    guard = crypto.randomUUID()
  await database.batch([
    database
      .prepare(
        'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN count(*)=0 THEN 1 ELSE 0 END FROM users',
      )
      .bind(guard),
    database
      .prepare(
        "INSERT INTO users(id,email,salt,hash,username,display_name,slug,attribution_label,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'administrator',?,?)",
      )
      .bind(
        identity.id,
        identity.email,
        identity.salt,
        identity.hash,
        identity.username || null,
        identity.display_name || null,
        identity.slug || null,
        identity.display_name || identity.username || `Account #${identity.id}`,
        now,
        now,
      ),
    database.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
  ])
  const bootstrap = await bootstrapTenant(database, {
    tenant: 'default',
    site: 'default',
    administratorEmail: email!,
  })
  const required = await database
    .prepare(
      "SELECT (SELECT count(*) FROM site_tpl WHERE slug='default-website-template') AS templates,(SELECT count(*) FROM design_block_designs WHERE slug LIKE 'hero-board-%') AS designs",
    )
    .first<{ templates: number; designs: number }>()
  if (required?.templates !== 1 || required.designs !== 4)
    throw Error('Required built-in templates are missing.')
  for (const table of [
    'posts',
    'pages',
    'media',
    'review_tasks',
    'vc_crm_constituents',
    'vc_automations',
    'vc_knowledge_pages',
  ]) {
    if ((await database.prepare(`SELECT count(*) n FROM ${table}`).first<{ n: number }>())?.n !== 0)
      throw Error(`Fresh installation contains unexpected content: ${table}.`)
  }
  await activateTenantAuthority(database, 'default')
  const retained = await administratorIdentity(database, email!)
  if (retained.hash !== identity.hash || retained.salt !== identity.salt)
    throw Error('Administrator credential continuity failed.')
  const portal = await seedPublishingPortals(database, { actor: bootstrap.administrator, release: crypto.randomUUID() })
  // No credential bytes leave this function through its result or receipt.
  return {
    mode: input.mode,
    ...migration,
    tenant: bootstrap.tenant,
    administrator: bootstrap.administrator,
    emptyContent: false,
    emptyUserContent: true,
    portal,
    builtInsVerified: true,
    credentialsVerified: true,
  }
}
