import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { up, down } from '@/migrations/20261011_233000_document_review'

describe('Additive review migration', () => {
  it('preserves existing content and builds task relationships and indexes', async () => {
    const database = new DatabaseSync(':memory:')
    database.exec(
      "PRAGMA foreign_keys=ON; CREATE TABLE users(id integer PRIMARY KEY); CREATE TABLE posts(id integer PRIMARY KEY, title text); INSERT INTO posts VALUES(1, 'Keep this content'); CREATE TABLE payload_locked_documents_rels(id integer PRIMARY KEY); INSERT INTO payload_locked_documents_rels VALUES(1);",
    )
    const db = {
      run: async (statement: { queryChunks: { value: string[] }[] }) =>
        database.exec(statement.queryChunks.map((chunk) => chunk.value.join('')).join('')),
    }
    try {
      await up({ db } as never)
      expect(database.prepare('SELECT title FROM posts WHERE id=1').get()).toEqual({
        title: 'Keep this content',
      })
      database.exec(
        "INSERT INTO users VALUES(1); INSERT INTO review_tasks(id,title,document_type,document_i_d,creator_id) VALUES(1,'Audit','pages','5',1); INSERT INTO review_comments(task_id,document_type,document_i_d,author_id,body) VALUES(1,'pages','5',1,'Review');",
      )
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'review_%'")
          .all().length,
      ).toBeGreaterThan(12)
      expect(database.prepare('SELECT status, priority FROM review_tasks').get()).toEqual({
        status: 'open',
        priority: 'normal',
      })
      await down({ db } as never)
      expect(database.prepare('SELECT title FROM posts').get()).toEqual({
        title: 'Keep this content',
      })
      expect(database.prepare('SELECT id FROM payload_locked_documents_rels').get()).toEqual({
        id: 1,
      })
    } finally {
      database.close()
    }
  })
})
