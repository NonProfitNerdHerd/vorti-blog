import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { up as review } from '@/migrations/20261011_233000_document_review'
import { up as boards } from '@/migrations/20261018_193401_tasks_workspace'
import { up as preferences } from '@/migrations/20261018_194411_workspace_preferences'
import { up, down } from '@/migrations/20261018_220320_projects_workspace'
import { up as revisions } from '@/migrations/20261018_224500_projects_audience_revisions'
import { up as starter, down as starterDown } from '@/migrations/20261019_145037_starter_workspace'

describe('Projects additive production migration', () => {
  it('preserves historical records, board audiences, and preferred views', async () => {
    const database = new DatabaseSync(':memory:')
    database.exec(
      'PRAGMA foreign_keys=ON; CREATE TABLE users(id integer PRIMARY KEY); INSERT INTO users VALUES(1),(2); CREATE TABLE payload_locked_documents_rels(id integer PRIMARY KEY); CREATE TABLE system_settings(id integer PRIMARY KEY);',
    )
    const db = {
      run: async (statement: { queryChunks: { value: string[] }[] }) =>
        database.exec(statement.queryChunks.map((chunk) => chunk.value.join('')).join('')),
    }
    try {
      for (const migration of [review, boards, preferences]) await migration({ db } as never)
      database.exec(
        "INSERT INTO task_boards(id,name,owner_id,visibility) VALUES(10,'Private board',1,'private'),(20,'Team board',2,'team'),(30,'Another private board',1,'private'); INSERT INTO task_board_memberships(id,board_id,user_id,role,key,edit_user_id,comment_user_id) VALUES(1,10,2,'editor','10:2',2,2); INSERT INTO review_tasks(id,title,document_type,document_i_d,creator_id,due_date) VALUES(10,'Historical task','pages','17',1,'2026-10-20T12:00:00.000Z'); INSERT INTO review_comments(id,task_id,body,document_type,document_i_d,author_id) VALUES(7,10,'Keep discussion','pages','17',1); INSERT INTO task_board_preferences(id,board_id,user_id,key,view) VALUES(1,10,2,'10:2','calendar');",
      )
      const before = database
        .prepare('SELECT id,name,owner_id,visibility,updated_at FROM task_boards ORDER BY id')
        .all()
      await up({ db } as never)
      await revisions({ db } as never)
      await starter({ db } as never)
      expect(database.prepare('SELECT workspace_initialized FROM users WHERE id=1').get()).toEqual({
        workspace_initialized: 0,
      })
      expect(
        database
          .prepare('SELECT count(*) AS total FROM task_projects WHERE starter_key IS NOT NULL')
          .get(),
      ).toEqual({ total: 0 })
      await expect(starterDown({ db } as never)).rejects.toThrow(
        'preserves starter initialization history',
      )
      const revision = () =>
        (
          database
            .prepare('SELECT membership_revision AS value FROM task_boards WHERE id=10')
            .get() as { value: number }
        ).value
      expect(revision()).toBe(0)
      database.exec(
        "UPDATE task_board_memberships SET role='viewer' WHERE id=1; UPDATE task_board_memberships SET role='editor' WHERE id=1;",
      )
      expect(revision()).toBe(2)
      database.exec("UPDATE task_board_memberships SET role='editor' WHERE id=1")
      expect(revision()).toBe(2)
      expect(
        database
          .prepare('SELECT id,name,owner_id,visibility,updated_at FROM task_boards ORDER BY id')
          .all(),
      ).toEqual(before)
      expect(database.prepare('SELECT count(*) AS total FROM task_projects').get()).toEqual({
        total: 2,
      })
      expect(
        database
          .prepare(
            'SELECT count(*) AS total FROM task_boards WHERE project_id IS NOT NULL AND inherit_project=0',
          )
          .get(),
      ).toEqual({ total: 3 })
      expect(database.prepare('SELECT count(*) AS total FROM task_views').get()).toEqual({
        total: 15,
      })
      expect(
        database
          .prepare(
            'SELECT v.kind FROM task_board_preferences p JOIN task_views v ON p.view_instance_id=v.id WHERE p.id=1',
          )
          .get(),
      ).toEqual({ kind: 'calendar' })
      expect(database.prepare('SELECT title,due_date FROM review_tasks WHERE id=10').get()).toEqual(
        { title: 'Historical task', due_date: '2026-10-20T12:00:00.000Z' },
      )
      expect(database.prepare('SELECT body FROM review_comments WHERE id=7').get()).toEqual({
        body: 'Keep discussion',
      })
      expect(
        database.prepare('SELECT count(*) AS total FROM task_board_memberships').get(),
      ).toEqual({ total: 1 })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      await expect(down({ db } as never)).rejects.toThrow('preserves collaboration history')
    } finally {
      database.close()
    }
  })
})
