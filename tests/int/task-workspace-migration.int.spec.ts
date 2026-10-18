import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { up as review } from '@/migrations/20261011_233000_document_review'
import { up } from '@/migrations/20261018_193401_tasks_workspace'

describe('Task workspace production migration', () => {
  it('adds collaboration without rebuilding or changing historical task relationships', async () => {
    const database = new DatabaseSync(':memory:')
    database.exec(
      'PRAGMA foreign_keys=ON; CREATE TABLE users(id integer PRIMARY KEY); CREATE TABLE payload_locked_documents_rels(id integer PRIMARY KEY); INSERT INTO users VALUES(1);',
    )
    const db = {
      run: async (statement: { queryChunks: { value: string[] }[] }) =>
        database.exec(statement.queryChunks.map((chunk) => chunk.value.join('')).join('')),
    }
    try {
      await review({ db } as never)
      database.exec(
        "INSERT INTO review_tasks(id,title,document_type,document_i_d,creator_id) VALUES(10,'Original','pages','8',1); INSERT INTO review_tasks(id,title,document_type,document_i_d,parent_id,creator_id) VALUES(11,'Child','pages','8',10,1); INSERT INTO review_comments(id,task_id,document_type,document_i_d,author_id,body) VALUES(3,10,'pages','8',1,'Keep comment'); INSERT INTO review_activity(id,task_id,document_type,document_i_d,actor_id,message) VALUES(4,10,'pages','8',1,'Keep activity'); INSERT INTO payload_locked_documents_rels(id,review_tasks_id) VALUES(1,10);",
      )
      await up({ db } as never)
      expect(
        database.prepare('SELECT title,parent_id,creator_id FROM review_tasks WHERE id=11').get(),
      ).toEqual({ title: 'Child', parent_id: 10, creator_id: 1 })
      expect(database.prepare('SELECT body,task_id FROM review_comments').get()).toEqual({
        body: 'Keep comment',
        task_id: 10,
      })
      expect(database.prepare('SELECT message,task_id FROM review_activity').get()).toEqual({
        message: 'Keep activity',
        task_id: 10,
      })
      expect(
        database.prepare('SELECT review_tasks_id FROM payload_locked_documents_rels').get(),
      ).toEqual({ review_tasks_id: 10 })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(() => database.exec("INSERT INTO task_workspace_guards VALUES('stale',0)")).toThrow()
      database.exec(
        "INSERT INTO review_tasks(id,title,document_type,document_i_d,creator_id,personal) VALUES(12,'Personal','none','',1,1)",
      )
      expect(database.prepare('SELECT personal FROM review_tasks WHERE id=12').get()).toEqual({
        personal: 1,
      })
    } finally {
      database.close()
    }
  })
})
