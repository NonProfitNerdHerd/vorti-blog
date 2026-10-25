import {
  crmTaskContextViewV1,
  crmTaskRecordExistsV1,
  crmTaskRecordRevisionV1,
  crmTaskConstituentsViewV1,
} from './task-context-v1'
export const crmTaskColumnsV1 = [
  'crm_site TEXT REFERENCES vc_sites(id)',
  'crm_type TEXT',
  'crm_i_d TEXT',
  'crm_activity_i_d TEXT REFERENCES vc_crm_activities(id)',
  'crm_operation_key TEXT',
  'crm_intent_hash TEXT',
  'crm_record_revision INTEGER',
  'crm_authority_revision INTEGER',
] as const
const validNew = crmTaskRecordExistsV1('NEW.crm_site', 'NEW.crm_type', 'NEW.crm_i_d')
const recordContext = `NEW.crm_type IS NOT NULL AND (NEW.crm_site IS NULL OR NEW.crm_i_d IS NULL OR NEW.document_site IS NOT NEW.crm_site OR NEW.crm_operation_key IS NULL OR length(NEW.crm_operation_key) NOT BETWEEN 16 AND 128 OR NEW.crm_intent_hash IS NULL OR length(NEW.crm_intent_hash)<>64 OR NOT (${validNew}) OR (NEW.crm_activity_i_d IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_activities activity WHERE activity.id=NEW.crm_activity_i_d AND activity.site_id=NEW.crm_site AND activity.constituent_id=NEW.crm_i_d AND NEW.crm_type='contact')))`
export const crmTaskSchemaV1 = [
  'CREATE INDEX IF NOT EXISTS review_tasks_crm_record_idx ON review_tasks(crm_site,crm_type,crm_i_d,id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS review_tasks_crm_operation_idx ON review_tasks(crm_operation_key) WHERE crm_operation_key IS NOT NULL',
  crmTaskContextViewV1,
  crmTaskConstituentsViewV1,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_task_initial_revision BEFORE INSERT ON review_tasks WHEN NEW.crm_type IS NOT NULL AND (NEW.crm_record_revision IS NOT (${crmTaskRecordRevisionV1('NEW.crm_site', 'NEW.crm_type', 'NEW.crm_i_d')}) OR NEW.crm_authority_revision IS NOT(SELECT o.authority_revision FROM vc_sites s JOIN vc_organizations o ON o.id=s.organization_id WHERE s.id=NEW.crm_site)) BEGIN SELECT RAISE(ABORT,'CRM follow-up source or permissions changed'); END`,
  ...['INSERT', 'UPDATE'].map(
    (event) =>
      `CREATE TRIGGER IF NOT EXISTS vc_crm_task_context_${event.toLowerCase()} BEFORE ${event} ON review_tasks WHEN (${recordContext}) OR (NEW.crm_type IS NULL AND (NEW.crm_site IS NOT NULL OR NEW.crm_i_d IS NOT NULL OR NEW.crm_activity_i_d IS NOT NULL OR NEW.crm_operation_key IS NOT NULL OR NEW.crm_intent_hash IS NOT NULL OR NEW.crm_record_revision IS NOT NULL OR NEW.crm_authority_revision IS NOT NULL)) OR (NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM review_tasks parent WHERE parent.id=NEW.parent_id AND (parent.crm_site IS NOT NEW.crm_site OR parent.crm_type IS NOT NEW.crm_type OR parent.crm_i_d IS NOT NEW.crm_i_d OR parent.crm_activity_i_d IS NOT NEW.crm_activity_i_d))) BEGIN SELECT RAISE(ABORT,'CRM task requires current retained chapter record context'); END`,
  ),
  `CREATE TRIGGER IF NOT EXISTS vc_crm_task_context_retained BEFORE UPDATE ON review_tasks WHEN NEW.crm_site IS NOT OLD.crm_site OR NEW.crm_type IS NOT OLD.crm_type OR NEW.crm_i_d IS NOT OLD.crm_i_d OR NEW.crm_activity_i_d IS NOT OLD.crm_activity_i_d OR NEW.crm_operation_key IS NOT OLD.crm_operation_key OR NEW.crm_intent_hash IS NOT OLD.crm_intent_hash OR NEW.crm_record_revision IS NOT OLD.crm_record_revision OR NEW.crm_authority_revision IS NOT OLD.crm_authority_revision BEGIN SELECT RAISE(ABORT,'CRM task links and retry lineage are retained'); END`,
  `CREATE TABLE IF NOT EXISTS vc_crm_task_events(id TEXT PRIMARY KEY NOT NULL,task_id INTEGER NOT NULL REFERENCES review_tasks(id),site_id TEXT NOT NULL REFERENCES vc_sites(id),record_type TEXT NOT NULL,record_id TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN('created','completed','reopened')),occurred_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_task_events_record_idx ON vc_crm_task_events(site_id,record_type,record_id,occurred_at,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_task_created AFTER INSERT ON review_tasks WHEN NEW.crm_type IS NOT NULL BEGIN INSERT INTO vc_crm_task_events(id,task_id,site_id,record_type,record_id,actor_id,kind,occurred_at) VALUES(lower(hex(randomblob(16))),NEW.id,NEW.crm_site,NEW.crm_type,NEW.crm_i_d,NEW.creator_id,'created',NEW.created_at); INSERT INTO vc_crm_task_events(id,task_id,site_id,record_type,record_id,actor_id,kind,occurred_at) SELECT lower(hex(randomblob(16))),NEW.id,NEW.crm_site,NEW.crm_type,NEW.crm_i_d,NEW.creator_id,'completed',NEW.created_at WHERE NEW.status='done'; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_task_status AFTER UPDATE ON review_tasks WHEN NEW.crm_type IS NOT NULL AND ((NEW.status='done' AND OLD.status<>'done') OR(NEW.status<>'done' AND OLD.status='done')) BEGIN INSERT INTO vc_crm_task_events(id,task_id,site_id,record_type,record_id,actor_id,kind,occurred_at) VALUES(lower(hex(randomblob(16))),NEW.id,NEW.crm_site,NEW.crm_type,NEW.crm_i_d,json_extract(NEW.platform_mutation_proof,'$.actor'),CASE WHEN NEW.status='done' THEN 'completed' ELSE 'reopened' END,NEW.updated_at); END`,
  ...['UPDATE', 'DELETE'].map(
    (event) =>
      `CREATE TRIGGER IF NOT EXISTS vc_crm_task_events_no_${event.toLowerCase()} BEFORE ${event} ON vc_crm_task_events BEGIN SELECT RAISE(ABORT,'CRM follow-up history is retained'); END`,
  ),
] as const

/** Dependent writes need the same live context check inside their native atomic
 * batch, even when affiliation revocation does not change a Task revision. */
export const crmTaskDependentTablesV1: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['review_comments', ['task_id']],
  ['review_activity', ['task_id']],
  ['task_board_activity', ['task_id']],
  ['task_attachments', ['task_id']],
  ['task_field_values', ['task_id']],
  ['task_placements', ['task_id']],
  ['task_followers', ['task_id']],
  ['task_time_entries', ['task_id']],
  ['task_dependencies', ['task_id', 'predecessor_id']],
  ['task_sharing_requests', ['task_id']],
]
export function crmTaskDependentTriggersV1(table: string, columns: readonly string[]) {
  return ['INSERT', 'UPDATE'].map(
    (event) =>
      `CREATE TRIGGER IF NOT EXISTS vc_crm_task_${table}_${event.toLowerCase()} BEFORE ${event} ON ${table} WHEN ${columns.map((column) => `EXISTS(SELECT 1 FROM review_tasks task WHERE task.id=NEW.${column} AND task.crm_type IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_task_contexts context WHERE context.task_id=task.id))`).join(' OR ')} BEGIN SELECT RAISE(ABORT,'Linked CRM task context is no longer available'); END`,
  )
}

/** Additive upgrade; do not register before the connected Tasks workflow passes.
 * Existing personal/board Tasks retain all IDs, data and audiences. */
export async function applyCRMTaskSchemaV1(
  execute: (statement: string) => Promise<unknown>,
  columns: (table?: string) => Promise<Array<{ name: string }>>,
  tables?: () => Promise<Array<{ name: string }>>,
) {
  const available = tables ? await tables() : []
  if (
    available.some(({ name }) =>
      ['vc_crm_task_contexts', 'vc_crm_task_constituents'].includes(name),
    )
  )
    throw new Error(
      'CRM task access requires database views; a schema-push table must be reviewed before migration.',
    )
  const existing = await columns()
  for (const column of crmTaskColumnsV1)
    if (!existing.some((value) => value.name === column.split(' ')[0]))
      await execute(`ALTER TABLE review_tasks ADD COLUMN ${column}`)
  for (const statement of crmTaskSchemaV1) await execute(statement)
  if (tables) {
    if (
      available.some((value) => value.name === 'task_board_activity') &&
      !(await columns('task_board_activity')).some((column) => column.name === 'task_id')
    )
      await execute(
        'ALTER TABLE task_board_activity ADD COLUMN task_id INTEGER REFERENCES review_tasks(id)',
      )
    for (const [table, columns] of crmTaskDependentTablesV1)
      if (available.some((value) => value.name === table))
        for (const statement of crmTaskDependentTriggersV1(table, columns)) await execute(statement)
    if (available.some((value) => value.name === 'review_tasks_rels'))
      for (const event of ['INSERT', 'UPDATE'])
        await execute(
          `CREATE TRIGGER IF NOT EXISTS vc_crm_task_board_site_${event.toLowerCase()} BEFORE ${event} ON review_tasks_rels WHEN NEW.path='boards' AND EXISTS(SELECT 1 FROM review_tasks task WHERE task.id=NEW.parent_id AND task.crm_type IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_boards board WHERE board.id=NEW.task_boards_id AND board.platform_site=task.crm_site)) BEGIN SELECT RAISE(ABORT,'CRM task board must belong to the record chapter'); END`,
        )
    if (available.some((value) => value.name === 'task_placements'))
      for (const event of ['INSERT', 'UPDATE'])
        await execute(
          `CREATE TRIGGER IF NOT EXISTS vc_crm_task_placement_site_${event.toLowerCase()} BEFORE ${event} ON task_placements WHEN EXISTS(SELECT 1 FROM review_tasks task WHERE task.id=NEW.task_id AND task.crm_type IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_boards board WHERE board.id=NEW.board_id AND board.platform_site=task.crm_site)) BEGIN SELECT RAISE(ABORT,'CRM task placement must belong to the record chapter'); END`,
        )
  }
}
