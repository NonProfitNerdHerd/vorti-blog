import {
  createLocalReq,
  type Payload,
  type PayloadRequest,
  type RequiredDataFromCollectionSlug,
} from 'payload'
import type { User } from '../../src/payload-types'
import { OrganizationRepository } from '../../src/organizations/repository'
import type { SiteRole } from '../../src/organizations/policy'
import { cmsSiteContext, CMS_DERIVED_READ } from '../../src/organizations/cms-scope'
import { PLATFORM_MIGRATION } from '../../src/organizations/account-guards'

export async function bootstrapFixtureOperator(payload: Payload) {
  const db = (payload.db as unknown as { client: D1Database }).client
  const count = await db.prepare('SELECT count(*) AS n FROM users').first<{ n: number }>()
  if (count?.n !== 0) throw Error('The fictional operator requires an empty local account table.')
  const req = await createLocalReq(
    { context: { purpose: 'disposable-test-bootstrap', [PLATFORM_MIGRATION]: true } },
    payload,
  )
  const operator = await payload.create({
    collection: 'users',
    req,
    overrideAccess: true,
    data: { username: 'dev', email: 'dev@payloadcms.com', password: 'test', role: 'administrator' },
  })
  await db
    .prepare('INSERT INTO vc_installation_operators(user_id,created_at) VALUES(?,?)')
    .bind(operator.id, new Date().toISOString())
    .run()
  const site = await db
    .prepare("SELECT revision FROM vc_sites WHERE id='default'")
    .first<{ revision: number }>()
  await new OrganizationRepository(db, operator.id).setMembership({
    site: 'default',
    user: operator.id,
    role: 'administrator',
    active: true,
    expectedRevision: site!.revision,
    operationKey: crypto.randomUUID(),
  })
  return operator
}

/** Explicit chapter authority for a fixture account; this never grants native
 * board audiences or installation-operator status. Call before creating requests. */
export async function grantFixtureMembership(
  payload: Payload,
  user: Pick<User, 'id'>,
  role: SiteRole,
  site = 'default',
) {
  const db = (payload.db as unknown as { client: D1Database }).client
  const operator = await db
    .prepare('SELECT user_id FROM vc_installation_operators ORDER BY user_id LIMIT 1')
    .first<{ user_id: number }>()
  const revision = await db
    .prepare('SELECT revision FROM vc_sites WHERE id=?')
    .bind(site)
    .first<{ revision: number }>()
  if (!operator || !revision)
    throw Error('The disposable native platform fixture was not initialized.')
  await new OrganizationRepository(db, operator.user_id).setMembership({
    site,
    user: user.id,
    role,
    active: true,
    expectedRevision: revision.revision,
    operationKey: crypto.randomUUID(),
  })
}

export async function createChapterUser(
  payload: Payload,
  role: SiteRole,
  options: {
    collection: 'users'
    data: RequiredDataFromCollectionSlug<'users'>
    req?: PayloadRequest
    overrideAccess?: boolean
  },
) {
  const user = await payload.create(options)
  await grantFixtureMembership(payload, user, role)
  return user
}

/** Only suites testing installation-wide administration use the bootstrap
 * operator; ordinary chapter editors remain separate unprivileged accounts. */
export async function fixtureOperator(payload: Payload) {
  const db = (payload.db as unknown as { client: D1Database }).client
  const row = await db
    .prepare('SELECT user_id FROM vc_installation_operators ORDER BY user_id LIMIT 1')
    .first<{ user_id: number }>()
  if (!row) throw Error('The disposable operator fixture is missing.')
  return payload.findByID({ collection: 'users', id: row.user_id, depth: 0 })
}

/** Authenticated setup/inspection, replacing legacy implicit Local API bypass.
 * Always return a fresh request after any preceding permission mutation. */
export async function fixtureRequest(payload: Payload) {
  const user = await fixtureOperator(payload)
  return createLocalReq(
    { user: { ...user, collection: 'users' }, context: cmsSiteContext('default') },
    payload,
  )
}

export async function fixtureDerivedRequest(payload: Payload) {
  const req = await fixtureRequest(payload)
  Object.assign(req.context, { [CMS_DERIVED_READ]: true })
  return req
}

/** Accounts referenced by retained audit history are deactivated, not deleted.
 * The whole disposable database is discarded after validation. */
export async function retireFixtureUser(payload: Payload, user: number) {
  const db = (payload.db as unknown as { client: D1Database }).client
  const operator = await fixtureOperator(payload)
  const status = await db
    .prepare('SELECT revision FROM vc_account_status WHERE user_id=?')
    .bind(user)
    .first<{ revision: number }>()
  await new OrganizationRepository(db, operator.id).setAccountStatus({
    user,
    disabled: true,
    expectedRevision: status?.revision ?? 0,
    reason: 'Disposable fixture cleanup',
    operationKey: crypto.randomUUID(),
  })
}
