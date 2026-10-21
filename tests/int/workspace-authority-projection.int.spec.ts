import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  workspaceProjectionSchemaV1,
  workspaceProjectionBackfillV1,
} from '../../src/organizations/workspace-projection-v1'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE task_projects(id INTEGER PRIMARY KEY,owner_id INTEGER,platform_site TEXT,visibility TEXT,archived INTEGER DEFAULT 0);
    CREATE TABLE task_boards(id INTEGER PRIMARY KEY,owner_id INTEGER,project_id INTEGER,inherit_project INTEGER DEFAULT 1,platform_site TEXT,visibility TEXT,archived INTEGER DEFAULT 0);
    CREATE TABLE task_board_memberships(id INTEGER PRIMARY KEY,board_id INTEGER,user_id INTEGER,role TEXT);
    CREATE TABLE task_project_memberships(id INTEGER PRIMARY KEY,project_id INTEGER,user_id INTEGER,role TEXT);`)
  for (const sql of [...workspaceProjectionSchemaV1, ...workspaceProjectionBackfillV1]) db.exec(sql)
  db.exec(`INSERT INTO task_projects(id,owner_id,platform_site,visibility) VALUES(1,1,'a','team'),(2,4,'b','team'),(3,5,NULL,'private');
    INSERT INTO task_boards(id,owner_id,project_id,inherit_project,platform_site,visibility)
      VALUES(1,2,1,1,'a','private'),(2,2,1,0,'a','private'),(3,4,2,1,'b','private'),(4,5,3,1,NULL,'private');`)
  const allowed = (board: number, key: string, permission = 'read') =>
    !!db
      .prepare(`SELECT 1 FROM vc_workspace_access WHERE board_id=? AND ${permission}_key=?`)
      .get(board, key)
  return { db, allowed }
}
describe('bounded workspace authority projection', () => {
  it('preserves inheritance, private exceptions, personal ownership, and separate team audiences', () => {
    const { db, allowed } = fixture()
    try {
      expect(allowed(1, 'site:a:user:1', 'owner')).toBe(true)
      expect(allowed(2, 'site:a:user:1')).toBe(false)
      expect(allowed(2, 'site:a:user:2', 'owner')).toBe(true)
      expect(allowed(1, 'site:a:team')).toBe(true)
      expect(allowed(1, 'site:b:team')).toBe(false)
      expect(allowed(3, 'site:a:team')).toBe(false)
      expect(allowed(4, 'personal:5', 'owner')).toBe(true)
      expect(allowed(4, 'site:a:team')).toBe(false)
    } finally {
      db.close()
    }
  })
  it('uses the highest applicable role and applies membership changes and archival atomically', () => {
    const { db, allowed } = fixture()
    try {
      db.exec(
        "INSERT INTO task_board_memberships VALUES(1,1,3,'viewer'); INSERT INTO task_project_memberships VALUES(1,1,3,'editor')",
      )
      expect(allowed(1, 'site:a:user:3', 'edit')).toBe(true)
      db.exec("UPDATE task_project_memberships SET role='commenter' WHERE id=1")
      expect(allowed(1, 'site:a:user:3', 'edit')).toBe(false)
      expect(allowed(1, 'site:a:user:3', 'comment')).toBe(true)
      db.exec('DELETE FROM task_project_memberships WHERE id=1')
      expect(allowed(1, 'site:a:user:3', 'comment')).toBe(false)
      expect(allowed(1, 'site:a:user:3')).toBe(true)
      db.exec('DELETE FROM task_board_memberships WHERE id=1')
      expect(allowed(1, 'site:a:user:3')).toBe(false)
      db.exec('UPDATE task_projects SET archived=1 WHERE id=1')
      expect(allowed(1, 'site:a:user:2', 'edit')).toBe(false)
      expect(allowed(1, 'site:a:user:2', 'owner')).toBe(true)
      db.exec(
        'UPDATE task_boards SET archived=1 WHERE id=1; UPDATE task_projects SET archived=0 WHERE id=1',
      )
      expect(allowed(1, 'site:a:user:2', 'edit')).toBe(false)
      db.exec('UPDATE task_boards SET archived=0 WHERE id=1')
      expect(allowed(1, 'site:a:user:2', 'edit')).toBe(true)
    } finally {
      db.close()
    }
  })
})
