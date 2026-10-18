import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { up } from '@/migrations/20261018_001622'
import { FormResources } from '@/forms/collections'
import { resourceCollection } from '@/forms/resource-config'

describe('Additive Settings hub migration', () => {
  for (const existing of [false, true]) {
    it(`preserves content and preferences with ${existing ? 'existing' : 'empty'} site settings`, async () => {
      const database = new DatabaseSync(':memory:')
      database.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE pages(id integer PRIMARY KEY);
        CREATE TABLE site_settings(id integer PRIMARY KEY, site_name text NOT NULL, site_tagline text, created_at text, updated_at text);
        CREATE TABLE system_settings(id integer PRIMARY KEY, categories_enabled integer);
        INSERT INTO system_settings VALUES(1, false);
        CREATE TABLE form_resources(id integer PRIMARY KEY, timezone text);
        INSERT INTO form_resources VALUES(4, 'Europe/Paris');
        CREATE TABLE posts(id integer PRIMARY KEY, title text);
        INSERT INTO posts VALUES(3, 'Preserved post');`)
      if (existing)
        database.exec(
          "INSERT INTO site_settings(id,site_name,site_tagline) VALUES(1,'Existing title','Existing tagline')",
        )
      try {
        const db = {
          run: async (statement: { queryChunks: Array<{ value: string[] }> }) =>
            database.exec(statement.queryChunks.map((chunk) => chunk.value.join('')).join('')),
        }
        await up({ db } as never)
        expect(
          database
            .prepare(
              'SELECT site_name, timezone, date_format, time_format, discourage_search_indexing, show_privacy_policy_link FROM site_settings',
            )
            .get(),
        ).toEqual({
          site_name: existing ? 'Existing title' : 'Vorti Blog',
          timezone: 'UTC',
          date_format: 'long',
          time_format: '12',
          discourage_search_indexing: 0,
          show_privacy_policy_link: 0,
        })
        expect(database.prepare('SELECT categories_enabled FROM system_settings').get()).toEqual({
          categories_enabled: 0,
        })
        expect(database.prepare('SELECT timezone FROM form_resources').get()).toEqual({
          timezone: 'Europe/Paris',
        })
        expect(database.prepare('SELECT title FROM posts').get()).toEqual({
          title: 'Preserved post',
        })
        expect(
          database
            .prepare('SELECT value FROM system_settings_tag_management_roles ORDER BY "order"')
            .all(),
        ).toEqual([{ value: 'administrator' }, { value: 'designer' }, { value: 'editor' }])
        database.exec(
          'INSERT INTO pages VALUES(9); UPDATE site_settings SET privacy_policy_page_id=9; DELETE FROM pages WHERE id=9;',
        )
        expect(database.prepare('SELECT privacy_policy_page_id FROM site_settings').get()).toEqual({
          privacy_policy_page_id: null,
        })
        expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      } finally {
        database.close()
      }
    })
  }
  it('defaults only new booking resources and preserves the hook through the resource wrapper', async () => {
    const wrapped = resourceCollection(FormResources, {} as never)
    const hook = wrapped.hooks!.beforeOperation![0]
    const req = { payload: { findGlobal: async () => ({ timezone: 'America/Chicago' }) } }
    const args = { data: { label: 'New resource' } as Record<string, unknown>, req }
    await hook({ args, operation: 'create' } as never)
    expect(args.data.timezone).toBe('America/Chicago')
    args.data.timezone = 'Europe/London'
    await hook({ args, operation: 'create' } as never)
    expect(args.data.timezone).toBe('Europe/London')
    delete args.data.timezone
    await hook({ args, operation: 'update' } as never)
    expect(args.data.timezone).toBeUndefined()
  })
})
