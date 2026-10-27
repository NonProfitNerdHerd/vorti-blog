/** Creation ownership is independent of the currently selected site or task audience. */
export const taskTenantTables = ['task_projects', 'task_boards', 'review_tasks'] as const

export const taskTenantGuardsV1 = [
  ...taskTenantTables.flatMap((table) => [
    `CREATE TRIGGER IF NOT EXISTS ${table}_creation_tenant_immutable BEFORE UPDATE OF creation_tenant ON ${table}
     WHEN OLD.creation_tenant IS NOT NEW.creation_tenant
     BEGIN SELECT RAISE(ABORT,'Creation tenant is immutable'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_creation_tenant_required BEFORE INSERT ON ${table}
     WHEN EXISTS(SELECT 1 FROM vc_tenant_installation) AND
       (NEW.creation_tenant IS NULL OR NOT EXISTS(SELECT 1 FROM vc_organizations WHERE id=NEW.creation_tenant))
     BEGIN SELECT RAISE(ABORT,'Creation tenant is required'); END`,
  ]),
  ...(['INSERT', 'UPDATE'] as const).flatMap((operation) => [
    `CREATE TRIGGER IF NOT EXISTS review_tasks_parent_tenant_${operation.toLowerCase()} BEFORE ${operation} ON review_tasks
     WHEN EXISTS(SELECT 1 FROM vc_tenant_installation WHERE tenant_id=NEW.creation_tenant) AND NEW.parent_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM review_tasks p WHERE p.id=NEW.parent_id AND p.creation_tenant=NEW.creation_tenant)
     BEGIN SELECT RAISE(ABORT,'Task parent belongs to another tenant'); END`,
    `CREATE TRIGGER IF NOT EXISTS review_tasks_board_tenant_${operation.toLowerCase()} BEFORE ${operation} ON review_tasks_rels
     WHEN NEW.task_boards_id IS NOT NULL AND EXISTS(SELECT 1 FROM vc_tenant_installation) AND NOT EXISTS(
       SELECT 1 FROM review_tasks t JOIN task_boards b ON b.creation_tenant=t.creation_tenant
       WHERE t.id=NEW.parent_id AND b.id=NEW.task_boards_id)
     BEGIN SELECT RAISE(ABORT,'Task board belongs to another tenant'); END`,
    `CREATE TRIGGER IF NOT EXISTS task_boards_project_tenant_${operation.toLowerCase()} BEFORE ${operation} ON task_boards
     WHEN EXISTS(SELECT 1 FROM vc_tenant_installation WHERE tenant_id=NEW.creation_tenant) AND NEW.project_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM task_projects p WHERE p.id=NEW.project_id AND p.creation_tenant=NEW.creation_tenant)
     BEGIN SELECT RAISE(ABORT,'Board project belongs to another tenant'); END`,
    ...taskTenantTables.map((table) => {
      const site = table === 'review_tasks' ? 'document_site' : 'platform_site'
      return `CREATE TRIGGER IF NOT EXISTS ${table}_tenant_site_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
       WHEN EXISTS(SELECT 1 FROM vc_tenant_installation WHERE tenant_id=NEW.creation_tenant) AND NEW.${site} IS NOT NULL AND NOT EXISTS(
         SELECT 1 FROM vc_sites s WHERE s.id=NEW.${site} AND s.organization_id=NEW.creation_tenant)
       BEGIN SELECT RAISE(ABORT,'Workspace site belongs to another tenant'); END`
    }),
  ]),
]
