/** Atomic audience revisions cover membership changes, including same-clock changes and reversals. */
export const workspaceRevisionTriggers = [
  'CREATE TRIGGER IF NOT EXISTS workspace_board_audience AFTER UPDATE OF owner_id,visibility,archived,project_id,inherit_project ON task_boards WHEN OLD.owner_id IS NOT NEW.owner_id OR OLD.visibility IS NOT NEW.visibility OR OLD.archived IS NOT NEW.archived OR OLD.project_id IS NOT NEW.project_id OR OLD.inherit_project IS NOT NEW.inherit_project BEGIN UPDATE task_boards SET membership_revision=coalesce(membership_revision,0)+1 WHERE id=NEW.id; END;',
  'CREATE TRIGGER IF NOT EXISTS workspace_project_audience AFTER UPDATE OF owner_id,visibility,archived ON task_projects WHEN OLD.owner_id IS NOT NEW.owner_id OR OLD.visibility IS NOT NEW.visibility OR OLD.archived IS NOT NEW.archived BEGIN UPDATE task_projects SET membership_revision=coalesce(membership_revision,0)+1 WHERE id=NEW.id; END;',
  ...(['board', 'project'] as const).flatMap((kind) => {
    const memberships = `task_${kind}_memberships`,
      parent = kind === 'board' ? 'task_boards' : 'task_projects',
      field = `${kind}_id`
    return [
      `CREATE TRIGGER IF NOT EXISTS workspace_${kind}_member_insert AFTER INSERT ON ${memberships} BEGIN UPDATE ${parent} SET membership_revision=coalesce(membership_revision,0)+1 WHERE id=NEW.${field}; END;`,
      `CREATE TRIGGER IF NOT EXISTS workspace_${kind}_member_delete AFTER DELETE ON ${memberships} BEGIN UPDATE ${parent} SET membership_revision=coalesce(membership_revision,0)+1 WHERE id=OLD.${field}; END;`,
      `CREATE TRIGGER IF NOT EXISTS workspace_${kind}_member_update AFTER UPDATE ON ${memberships} WHEN OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role OR OLD.${field} IS NOT NEW.${field} BEGIN UPDATE ${parent} SET membership_revision=coalesce(membership_revision,0)+1 WHERE id=OLD.${field} OR id=NEW.${field}; END;`,
    ]
  }),
]
const initialized = new WeakSet<D1Database>()
export async function ensureWorkspaceRevisions(binding: D1Database) {
  if (initialized.has(binding)) return
  for (const statement of workspaceRevisionTriggers) await binding.prepare(statement).run()
  initialized.add(binding)
}
