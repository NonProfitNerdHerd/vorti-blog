import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Additive username migration', () => {
  it('retains credentials, IDs and legacy attribution while backfilling selector labels', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(
        "CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT, display_name TEXT, slug TEXT, hash TEXT, salt TEXT); INSERT INTO users VALUES(7,'legacy@example.com','Legacy Author','stable-author','unchanged-hash','unchanged-salt');",
      )
      const source = fs
        .readFileSync('src/migrations/20261018_180337_usernames.ts', 'utf8')
        .split('export async function down')[0]
      for (const match of source.matchAll(/await db\.run\(sql`((?:\\.|[^`])*)`\)/g))
        db.exec(match[1].replaceAll('\\`', '`'))
      expect(db.prepare('SELECT * FROM users').get()).toEqual({
        id: 7,
        email: 'legacy@example.com',
        display_name: 'Legacy Author',
        slug: 'stable-author',
        hash: 'unchanged-hash',
        salt: 'unchanged-salt',
        username: null,
        attribution_preference: null,
        attribution_label: 'legacy@example.com',
      })
      expect(source).not.toContain('DROP TABLE')
    } finally {
      db.close()
    }
  })
})
