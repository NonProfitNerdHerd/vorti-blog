import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import {
  workspaceProjectionSchemaV1,
  workspaceProjectionBackfillV1,
} from '../organizations/workspace-projection-v1'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const indexes = await db.all<{ name: string; unique: number }>(
    sql.raw('PRAGMA index_list("forms")'),
  )
  for (const index of indexes.filter(
    (index) => index.unique === 1 && !index.name.startsWith('sqlite_autoindex'),
  )) {
    const fields = await db.all<{ name: string }>(
      sql.raw(`PRAGMA index_info("${index.name.replaceAll('"', '""')}")`),
    )
    if (fields.length === 1 && fields[0].name === 'slug')
      await db.run(sql.raw(`DROP INDEX "${index.name.replaceAll('"', '""')}"`))
  }
  await db.run(sql.raw('CREATE UNIQUE INDEX IF NOT EXISTS site_slug_idx ON forms(site,slug)'))
  await db.run(sql.raw('CREATE INDEX IF NOT EXISTS forms_slug_idx ON forms(slug)'))
  for (const [table, column] of [
    ['task_projects', 'platform_site'],
    ['task_boards', 'platform_site'],
    ['review_tasks', 'document_site'],
  ]) {
    const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${table}")`))
    if (!columns.some((field) => field.name === column))
      await db.run(sql.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" text`))
    await db.run(
      sql.raw(`CREATE INDEX IF NOT EXISTS "${table}_${column}_idx" ON "${table}" ("${column}")`),
    )
  }
  // Private historical work remains personal, not owned by a nonprofit administrator.
  await db.run(
    sql.raw(
      "UPDATE task_projects SET platform_site='default' WHERE visibility='team' AND platform_site IS NULL",
    ),
  )
  await db.run(
    sql.raw(
      "UPDATE task_boards SET platform_site='default' WHERE platform_site IS NULL AND (visibility='team' OR project_id IN(SELECT id FROM task_projects WHERE platform_site='default'))",
    ),
  )
  await db.run(
    sql.raw(
      "UPDATE review_tasks SET document_site='default' WHERE document_type IN('posts','pages','design-templates','site-templates') AND document_site IS NULL",
    ),
  )
  for (const statement of [...workspaceProjectionSchemaV1, ...workspaceProjectionBackfillV1])
    await db.run(sql.raw(statement))
  const lockColumns = await db.all<{ name: string }>(
    sql.raw('PRAGMA table_info("payload_locked_documents_rels")'),
  )
  if (!lockColumns.some((column) => column.name === 'vc_workspace_access_id'))
    await db.run(
      sql.raw(
        'ALTER TABLE payload_locked_documents_rels ADD COLUMN vc_workspace_access_id text REFERENCES vc_workspace_access(id) ON DELETE CASCADE',
      ),
    )
  await db.run(
    sql.raw(
      'CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_vc_workspace_access_id_idx ON payload_locked_documents_rels(vc_workspace_access_id)',
    ),
  )
  for (const table of ['task_projects', 'task_boards']) {
    await db.run(
      sql.raw(
        `CREATE TRIGGER IF NOT EXISTS ${table}_vc_team_insert BEFORE INSERT ON ${table} WHEN NEW.visibility='team' AND (NEW.platform_site IS NULL OR NOT EXISTS(SELECT 1 FROM vc_sites WHERE id=NEW.platform_site)) BEGIN SELECT RAISE(ABORT,'Team work requires an owning site'); END`,
      ),
    )
    await db.run(
      sql.raw(
        `CREATE TRIGGER IF NOT EXISTS ${table}_vc_site_update BEFORE UPDATE ON ${table} WHEN OLD.platform_site IS NOT NEW.platform_site OR (NEW.visibility='team' AND NEW.platform_site IS NULL) BEGIN SELECT RAISE(ABORT,'Workspace ownership is immutable'); END`,
      ),
    )
  }
  await db.run(
    sql.raw(
      "CREATE TRIGGER IF NOT EXISTS review_tasks_vc_document_site_update BEFORE UPDATE OF document_site ON review_tasks WHEN OLD.document_site IS NOT NEW.document_site BEGIN SELECT RAISE(ABORT,'Document task ownership is immutable'); END",
    ),
  )
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Workspace ownership is retained. Restore a reviewed recovery point to revert.')
}
