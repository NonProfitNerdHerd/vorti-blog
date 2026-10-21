/** Frozen, database-maintained workspace audience index. No accessible-ID lists or per-member API loops. */
function projectRows(filter: string): string {
  const key =
    "CASE WHEN p.platform_site IS NULL THEN 'personal:'||x.uid ELSE 'site:'||p.platform_site||':user:'||x.uid END"
  return `INSERT INTO vc_workspace_access(id,board_id,project_id,read_key,edit_key,comment_key,owner_key)
    SELECT 'project:'||p.id||':'||x.uid,NULL,p.id,${key},
      CASE WHEN MAX(x.rank)>=3 AND COALESCE(p.archived,0)=0 THEN ${key} END,
      CASE WHEN MAX(x.rank)>=2 AND COALESCE(p.archived,0)=0 THEN ${key} END,
      CASE WHEN MAX(x.rank)=4 THEN ${key} END
    FROM task_projects p JOIN (
      SELECT p.id AS container,p.owner_id AS uid,4 AS rank FROM task_projects p WHERE ${filter}
      UNION ALL SELECT p.id,m.user_id,CASE m.role WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END
      FROM task_projects p JOIN task_project_memberships m ON m.project_id=p.id WHERE ${filter}
    ) x ON x.container=p.id WHERE x.uid IS NOT NULL GROUP BY p.id,x.uid;
    INSERT INTO vc_workspace_access(id,board_id,project_id,read_key)
    SELECT 'project:'||p.id||':team',NULL,p.id,'site:'||p.platform_site||':team' FROM task_projects p
    WHERE ${filter} AND p.visibility='team' AND p.platform_site IS NOT NULL;`
}
function boardRows(filter: string): string {
  const key =
    "CASE WHEN b.platform_site IS NULL THEN 'personal:'||x.uid ELSE 'site:'||b.platform_site||':user:'||x.uid END"
  const editable = 'COALESCE(b.archived,0)=0 AND COALESCE(p.archived,0)=0'
  return `INSERT INTO vc_workspace_access(id,board_id,project_id,read_key,edit_key,comment_key,owner_key)
    SELECT 'board:'||b.id||':'||x.uid,b.id,NULL,${key},
      CASE WHEN MAX(x.rank)>=3 AND ${editable} THEN ${key} END,
      CASE WHEN MAX(x.rank)>=2 AND ${editable} THEN ${key} END,
      CASE WHEN MAX(x.rank)=4 THEN ${key} END
    FROM task_boards b LEFT JOIN task_projects p ON p.id=b.project_id JOIN (
      SELECT b.id AS container,b.owner_id AS uid,4 AS rank FROM task_boards b WHERE ${filter}
      UNION ALL SELECT b.id,m.user_id,CASE m.role WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END
      FROM task_boards b JOIN task_board_memberships m ON m.board_id=b.id WHERE ${filter}
      UNION ALL SELECT b.id,p.owner_id,4 FROM task_boards b JOIN task_projects p ON p.id=b.project_id
      WHERE ${filter} AND b.inherit_project=1
      UNION ALL SELECT b.id,m.user_id,CASE m.role WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END
      FROM task_boards b JOIN task_project_memberships m ON m.project_id=b.project_id WHERE ${filter} AND b.inherit_project=1
    ) x ON x.container=b.id WHERE x.uid IS NOT NULL GROUP BY b.id,x.uid;
    INSERT INTO vc_workspace_access(id,board_id,project_id,read_key)
    SELECT 'board:'||b.id||':team',b.id,NULL,'site:'||b.platform_site||':team' FROM task_boards b
    LEFT JOIN task_projects p ON p.id=b.project_id WHERE ${filter} AND b.platform_site IS NOT NULL
      AND (b.visibility='team' OR(b.inherit_project=1 AND p.visibility='team'));`
}
const refreshBoard = (filter: string) =>
  `DELETE FROM vc_workspace_access WHERE board_id IN(SELECT b.id FROM task_boards b WHERE ${filter}); ${boardRows(filter)}`
const refreshProject = (
  filter: string,
) => `DELETE FROM vc_workspace_access WHERE project_id IN(SELECT p.id FROM task_projects p WHERE ${filter}); ${projectRows(filter)}
  ${refreshBoard(`b.project_id IN(SELECT p.id FROM task_projects p WHERE ${filter})`)}`
export const workspaceProjectionSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_workspace_access(id TEXT PRIMARY KEY NOT NULL,board_id INTEGER REFERENCES task_boards(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES task_projects(id) ON DELETE SET NULL,read_key TEXT,edit_key TEXT,comment_key TEXT,owner_key TEXT)`,
  ...['board_id', 'project_id', 'read_key', 'edit_key', 'comment_key', 'owner_key'].map(
    (column) =>
      `CREATE INDEX IF NOT EXISTS vc_workspace_access_${column.replace(/_id$/, '')}_idx ON vc_workspace_access(${column})`,
  ),
  `CREATE TRIGGER IF NOT EXISTS vc_board_access_insert AFTER INSERT ON task_boards BEGIN ${refreshBoard('b.id=NEW.id')} END`,
  `CREATE TRIGGER IF NOT EXISTS vc_board_access_update AFTER UPDATE OF owner_id,visibility,inherit_project,project_id,archived,platform_site ON task_boards BEGIN ${refreshBoard('b.id=NEW.id')} END`,
  `CREATE TRIGGER IF NOT EXISTS vc_board_access_delete BEFORE DELETE ON task_boards BEGIN DELETE FROM vc_workspace_access WHERE board_id=OLD.id; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_project_access_insert AFTER INSERT ON task_projects BEGIN ${refreshProject('p.id=NEW.id')} END`,
  `CREATE TRIGGER IF NOT EXISTS vc_project_access_update AFTER UPDATE OF owner_id,visibility,archived,platform_site ON task_projects BEGIN ${refreshProject('p.id=NEW.id')} END`,
  `CREATE TRIGGER IF NOT EXISTS vc_project_access_delete BEFORE DELETE ON task_projects BEGIN DELETE FROM vc_workspace_access WHERE project_id=OLD.id; END`,
  ...(['board', 'project'] as const).flatMap((kind) =>
    ['INSERT', 'UPDATE', 'DELETE'].map((operation) => {
      const collection = kind === 'board' ? 'task_board_memberships' : 'task_project_memberships'
      const refs =
        operation === 'INSERT' ? ['NEW'] : operation === 'DELETE' ? ['OLD'] : ['OLD', 'NEW']
      const filter = `${kind[0]}.id IN(${refs.map((ref) => `${ref}.${kind}_id`).join(',')})`
      return `CREATE TRIGGER IF NOT EXISTS vc_${kind}_member_access_${operation.toLowerCase()} AFTER ${operation} ON ${collection} BEGIN ${kind === 'board' ? refreshBoard(filter) : refreshProject(filter)} END`
    }),
  ),
] as const
export const workspaceProjectionBackfillV1 =
  `DELETE FROM vc_workspace_access; ${projectRows('1=1')} ${boardRows('1=1')}`
    .split(';')
    .map((sql) => sql.trim())
    .filter(Boolean)
