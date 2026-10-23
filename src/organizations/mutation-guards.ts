import { APIError, type Config, type Field, type PayloadRequest } from 'payload'
import { authorityClaim } from './claims'
import { cmsDatabase, migrationRequest } from './cms-scope'
import { claimRequest, confirmRequestAuthority } from './identity-authority'
import {
  captureWorkspaceProof,
  workspaceProofIsCurrent,
  type WorkspaceProof,
} from './workspace-proof'
const nativeAudience = Symbol('native-workspace-audience-proof')
const deleteAudiences = Symbol('native-delete-audience-proofs')

/** Frozen names shared by the native schema migration and runtime plugin. */
export const guardedMutations: ReadonlyArray<readonly [string, string, string | null]> = [
  ['users', 'users', null],
  ['forms', 'forms', '_forms_v'],
  ['form-submissions', 'form_submissions', null],
  ['form-resources', 'form_resources', null],
  ['form-templates', 'form_templates', null],
  ['form-integrations', 'form_integrations', null],
  ['task-projects', 'task_projects', null],
  ['task-boards', 'task_boards', null],
  ['review-tasks', 'review_tasks', null],
  ['review-comments', 'review_comments', null],
  ['review-activity', 'review_activity', null],
  ['task-attachments', 'task_attachments', null],
  ...[
    'form-revisions',
    'form-drafts',
    'form-attachments',
    'form-outbox',
    'form-audit',
    'form-analytics',
    'form-deliveries',
    'form-exports',
    'form-contacts',
    'form-support-requests',
    'task-project-memberships',
    'task-project-preferences',
    'task-board-memberships',
    'task-sections',
    'task-placements',
    'task-followers',
    'task-board-preferences',
    'task-sharing-requests',
    'task-notifications',
    'task-board-activity',
    'task-views',
    'task-board-fields',
    'task-board-pages',
    'task-baselines',
    'task-board-messages',
    'task-field-definitions',
    'task-field-values',
    'task-dependencies',
    'task-time-entries',
    'task-time-audit',
    'task-countdowns',
    'task-capacities',
    'task-message-followers',
    'task-project-changes',
    'task-notification-events',
  ].map((slug): readonly [string, string, null] => [slug, slug.replaceAll('-', '_'), null]),
] as const

const proofField: Field = {
  name: 'platformMutationProof',
  type: 'json',
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false },
}

// A proof is written only by the last server hook. Internal anonymous runtime writes
// clear it; ordinary authenticated operations always carry a current actor/epoch.
function validProof(column: string): string {
  return `${column} IS NULL OR EXISTS(
    SELECT 1 FROM vc_sites s JOIN vc_organizations o ON o.id=s.organization_id
    JOIN users u ON u.id=json_extract(${column},'$.actor')
    WHERE s.id=json_extract(${column},'$.site') AND o.authority_revision=json_extract(${column},'$.epoch')
    AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=u.id AND a.disabled=1)
    AND ${workspaceProofIsCurrent(`json_extract(${column},'$.audiences')`)}
    AND NOT EXISTS(SELECT 1 FROM vc_site_ancestry a JOIN vc_sites p ON p.id=a.ancestor_id WHERE a.descendant_id=s.id AND p.archived=1))`
}
export const nativeMutationGuardsV1 = guardedMutations.flatMap(([slug, table, versions]) => [
  ...['INSERT', 'UPDATE'].map(
    (operation) =>
      `CREATE TRIGGER IF NOT EXISTS ${table}_vc_mutation_${operation.toLowerCase()} BEFORE ${operation === 'UPDATE' ? 'UPDATE OF platform_mutation_proof' : operation} ON "${table}" WHEN NOT (${validProof('NEW.platform_mutation_proof')}) BEGIN SELECT RAISE(ABORT,'Mutation authority changed'); END`,
  ),
  `CREATE TRIGGER IF NOT EXISTS ${table}_vc_mutation_delete BEFORE DELETE ON "${table}" WHEN EXISTS(SELECT 1 FROM vc_native_delete_proofs WHERE collection='${slug}' AND record_id=CAST(OLD.id AS TEXT)) AND NOT EXISTS(
    SELECT 1 FROM vc_native_delete_proofs p JOIN vc_organizations o ON o.id=p.organization_id
    WHERE p.collection='${slug}' AND p.record_id=CAST(OLD.id AS TEXT) AND p.authority_revision=o.authority_revision
    AND julianday(p.created_at)>=julianday('now','-5 minutes')
    AND ${workspaceProofIsCurrent('p.workspace_proof')}
    AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=p.actor_id AND a.disabled=1))
    BEGIN SELECT RAISE(ABORT,'Delete authority changed'); END`,
  `CREATE TRIGGER IF NOT EXISTS ${table}_vc_mutation_deleted AFTER DELETE ON "${table}" BEGIN DELETE FROM vc_native_delete_proofs WHERE collection='${slug}' AND record_id=CAST(OLD.id AS TEXT); END`,
  ...(versions
    ? ['INSERT', 'UPDATE'].map(
        (operation) =>
          `CREATE TRIGGER IF NOT EXISTS ${versions}_vc_mutation_${operation.toLowerCase()} BEFORE ${operation} ON "${versions}" WHEN NOT (${validProof('NEW.version_platform_mutation_proof')}) BEGIN SELECT RAISE(ABORT,'Version mutation authority changed'); END`,
      )
    : []),
])
export const nativeMutationSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_native_delete_proofs (
    collection TEXT NOT NULL,record_id TEXT NOT NULL,organization_id TEXT NOT NULL REFERENCES vc_organizations(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),authority_revision INTEGER NOT NULL,created_at TEXT NOT NULL,workspace_proof TEXT,
    PRIMARY KEY(collection,record_id))`,
] as const

/** Payload authentication uses full-row upserts to maintain hashes/reset tokens and login
 * counters. A stored staff proof is not authorization for that separate native token flow.
 * Permit only unchanged account data/proof; every ordinary hook-based write gets a fresh nonce.
 * Derive protected fields from the installed schema so new account fields fail closed. */
export function nativeUserAuthenticationGuardsV2(columns: string[]): string[] {
  if (!columns.includes('id') || !columns.includes('role') || !columns.includes('platform_mutation_proof') ||
    columns.some(column => !/^[a-zA-Z0-9_]+$/.test(column))) throw new Error('Invalid account guard schema.')
  const authenticationFields = new Set(['platform_mutation_proof', 'updated_at', 'login_attempts', 'lock_until',
    'reset_password_token', 'reset_password_expiration', 'salt', 'hash'])
  const unchanged = columns.filter(column => !authenticationFields.has(column))
    .map(column => `account."${column}" IS NEW."${column}"`).join(' AND ')
  const maintenance = `EXISTS(SELECT 1 FROM users account WHERE account.id=NEW.id
    AND account.platform_mutation_proof IS NEW.platform_mutation_proof AND ${unchanged})`
  return ['INSERT', 'UPDATE'].flatMap(operation => [
    `DROP TRIGGER IF EXISTS users_vc_mutation_${operation.toLowerCase()}`,
    `CREATE TRIGGER users_vc_mutation_${operation.toLowerCase()} BEFORE ${operation === 'UPDATE' ? 'UPDATE OF platform_mutation_proof' : operation} ON users
      WHEN NOT ((${validProof('NEW.platform_mutation_proof')}) OR ${maintenance})
      BEGIN SELECT RAISE(ABORT,'Mutation authority changed'); END`,
  ])
}

export const tenantMutationGuards = (config: Config): Config => ({
  ...config,
  collections: (config.collections || []).map((collection) => {
    if (!guardedMutations.some(([slug]) => slug === collection.slug)) return collection
    return {
      ...collection,
      fields: [...collection.fields, proofField],
      hooks: {
        ...collection.hooks,
        afterRead: [
          ...(collection.hooks?.afterRead || []),
          ({ doc }) => {
            // Some authorized service responses use overrideAccess. Never expose commit
            // witnesses (including hidden board IDs) through those privileged reads.
            const safe = { ...doc }
            delete safe.platformMutationProof
            return safe
          },
        ],
        beforeOperation: [
          async ({ args, req }) => {
            if (
              !migrationRequest(req) &&
              'data' in args &&
              args.data &&
              Object.hasOwn(args.data, 'platformMutationProof')
            )
              throw new APIError('Mutation authority is server-managed.', 403)
            return args
          },
          ...(collection.hooks?.beforeOperation || []),
        ],
        beforeValidate: [
          async ({ data, originalDoc, req }) => {
            if (!data) return data
            const claim = authorityClaim(req.user)
            if (!migrationRequest(req) && claim && !claim.bootstrap) {
              const proof = await captureWorkspaceProof(req, collection.slug, data, originalDoc)
              ;(data as Record<symbol, unknown>)[nativeAudience] = proof
              if (originalDoc) (originalDoc as Record<symbol, unknown>)[nativeAudience] = proof
              if (collection.slug === 'task-attachments') {
                const { validateWorkspaceAttachment } = await import('../review/workspace-files')
                await validateWorkspaceAttachment(req, data, originalDoc)
              }
            }
            return data
          },
          ...(collection.hooks?.beforeValidate || []),
        ],
        beforeChange: [
          ...(collection.hooks?.beforeChange || []),
          async ({ data, originalDoc, req }) => {
            if (migrationRequest(req)) return { ...data, platformMutationProof: null }
            await claimRequest(req)
            await confirmRequestAuthority(req)
            const claim = authorityClaim(req.user)
            const audiences = ((data as Record<symbol, unknown>)[nativeAudience] ||
              (originalDoc as Record<symbol, unknown> | undefined)?.[nativeAudience]) as
              WorkspaceProof | undefined
            delete (data as Record<symbol, unknown>)[nativeAudience]
            if (originalDoc) delete (originalDoc as Record<symbol, unknown>)[nativeAudience]
            if (audiences) {
              const current = await captureWorkspaceProof(req, collection.slug, data, originalDoc)
              for (const kind of ['boards', 'projects', 'tasks'] as const)
                for (const witness of current[kind]) {
                  const before = audiences[kind].find((row) => row.id === witness.id)
                  if (
                    before &&
                    (before.updated !== witness.updated || before.revision !== witness.revision)
                  )
                    throw new APIError('Workspace changed. Reload before saving.', 409)
                  if (!before) audiences[kind].push(witness)
                }
            }
            if (
              claim &&
              !claim.bootstrap &&
              (collection.slug.startsWith('task-') || collection.slug.startsWith('review-')) &&
              !audiences
            )
              throw new APIError('Workspace changed. Reload before saving.', 409)
            return {
              ...data,
              platformMutationProof:
                claim && !claim.bootstrap
                  ? {
                      actor: claim.actor,
                      site: claim.site,
                      epoch: claim.epoch,
                      nonce: crypto.randomUUID(),
                      audiences,
                    }
                  : null,
            }
          },
        ],
        beforeDelete: [
          async ({ id, req }) => {
            const claim = authorityClaim(req.user)
            if (migrationRequest(req) || !claim || claim.bootstrap) return
            const table = guardedMutations.find(([slug]) => slug === collection.slug)![1]
            const original = await cmsDatabase(req)
              .prepare(`SELECT * FROM "${table}" WHERE id=?`)
              .bind(id)
              .first<Record<string, unknown>>()
            if (!original) throw new APIError('Record unavailable.', 404)
            const proofs = ((req.context as Record<symbol, unknown>)[deleteAudiences] ||= new Map<
              string,
              WorkspaceProof
            >()) as Map<string, WorkspaceProof>
            proofs.set(
              `${collection.slug}:${id}`,
              await captureWorkspaceProof(req, collection.slug, {}, original),
            )
            if (collection.slug === 'task-attachments') {
              const { validateWorkspaceAttachment } = await import('../review/workspace-files')
              await validateWorkspaceAttachment(req, {}, original, true)
            }
          },
          ...(collection.hooks?.beforeDelete || []),
          async ({ id, req }) => {
            if (migrationRequest(req)) return
            await claimRequest(req)
            await confirmRequestAuthority(req)
            const claim = authorityClaim(req.user)
            if (!claim) {
              // Actorless maintenance is already authorized by its server-only entry point.
              // A failed earlier staff delete must not permanently block that cleanup.
              const db = cmsDatabase(req)
              if (await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='vc_native_delete_proofs'").first())
                await db.prepare('DELETE FROM vc_native_delete_proofs WHERE collection=? AND record_id=?').bind(collection.slug, String(id)).run()
              return
            }
            if (claim.bootstrap) return
            const audiences = (
              (req.context as Record<symbol, unknown>)[deleteAudiences] as
                Map<string, WorkspaceProof> | undefined
            )?.get(`${collection.slug}:${id}`)
            await cmsDatabase(req)
              .prepare(
                `INSERT INTO vc_native_delete_proofs(collection,record_id,organization_id,actor_id,authority_revision,created_at,workspace_proof)
            VALUES(?,?,?,?,?,?,?) ON CONFLICT(collection,record_id) DO UPDATE SET organization_id=excluded.organization_id,actor_id=excluded.actor_id,authority_revision=excluded.authority_revision,created_at=excluded.created_at,workspace_proof=excluded.workspace_proof`,
              )
              .bind(
                collection.slug,
                String(id),
                claim.organization,
                claim.actor,
                claim.epoch,
                new Date().toISOString(),
                audiences ? JSON.stringify(audiences) : null,
              )
              .run()
          },
        ],
      },
    }
  }),
})

/** Embed in the same batch as raw SQL mutations; a response-time check cannot undo writes. */
export async function mutationFence(
  req: PayloadRequest,
  audiences?: WorkspaceProof,
): Promise<D1PreparedStatement[]> {
  if (migrationRequest(req)) return []
  await claimRequest(req)
  await confirmRequestAuthority(req)
  const claim = authorityClaim(req.user)
  if (!claim || claim.bootstrap) return []
  const db = cmsDatabase(req),
    key = crypto.randomUUID()
  return [
    db
      .prepare(
        `INSERT INTO vc_write_guards(operation_key,affected)
    SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM vc_organizations WHERE id=? AND authority_revision=?
      AND NOT EXISTS(SELECT 1 FROM vc_account_status WHERE user_id=? AND disabled=1)) THEN 1 ELSE 0 END`,
      )
      .bind(key, claim.organization, claim.epoch, claim.actor),
    ...(audiences
      ? [
          db
            .prepare(
              `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN ${workspaceProofIsCurrent('?')} THEN 1 ELSE 0 END`,
            )
            .bind(
              key + ':workspace',
              JSON.stringify(audiences),
              JSON.stringify(audiences),
              JSON.stringify(audiences),
            ),
          db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key + ':workspace'),
        ]
      : []),
    db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key),
  ]
}
