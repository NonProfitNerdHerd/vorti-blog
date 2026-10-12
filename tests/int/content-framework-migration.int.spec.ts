import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect } from 'vitest'
import { up } from '@/migrations/20261012_040000_post_types_views'
describe('Post Types and Views migration', () => {
  it('creates definitions, versions, relationships and event index without touching accounts', async () => {
    const database = new DatabaseSync(':memory:')
    database.exec(
      "PRAGMA foreign_keys=ON;CREATE TABLE users(id integer PRIMARY KEY,email text);INSERT INTO users VALUES(1,'preserve@example.invalid');CREATE TABLE posts(id integer PRIMARY KEY);INSERT INTO posts VALUES(1);CREATE TABLE _posts_v(id integer PRIMARY KEY);CREATE TABLE design_templates(id integer PRIMARY KEY,_status text);CREATE TABLE payload_locked_documents_rels(id integer PRIMARY KEY);",
    )
    const db = {
      run: async (statement: { queryChunks: { value: string[] }[] }) =>
        database.exec(statement.queryChunks.map((c) => c.value.join('')).join('')),
    }
    try {
      await up({ db } as never)
      expect(database.prepare('SELECT key FROM post_types ORDER BY id').all()).toEqual([
        { key: 'post' },
        { key: 'event' },
      ])
      expect(database.prepare('SELECT post_type_id FROM posts').get()).toEqual({ post_type_id: 1 })
      expect(database.prepare('SELECT email FROM users').get()).toEqual({
        email: 'preserve@example.invalid',
      })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })
})
