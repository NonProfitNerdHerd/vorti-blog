import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { up, down } from '@/migrations/20261020_170954_reusable_menus'
type SQL = { toQuery: (config: unknown) => { sql: string; params: unknown[] } }
describe('menu migration preservation', () => {
  it('copies both menus once, retains rows and flags, and never overwrites edited menus on retry', async () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(
      "PRAGMA foreign_keys=ON; CREATE TABLE navigation(id integer PRIMARY KEY,updated_at text,created_at text); INSERT INTO navigation VALUES(1,'unchanged','original'); CREATE TABLE payload_locked_documents_rels(id integer PRIMARY KEY); CREATE TABLE pages(id integer PRIMARY KEY,title text); INSERT INTO pages VALUES(5,'Preserved page');",
    )
    for (const slot of ['primary', 'footer']) {
      sqlite.exec(
        `CREATE TABLE navigation_${slot}(_order integer,_parent_id integer,id text PRIMARY KEY,label text,link_type text,page_id integer,url text,new_tab integer,enabled integer); CREATE TABLE navigation_${slot}_children(_order integer,_parent_id text,id text PRIMARY KEY,label text,link_type text,page_id integer,url text,new_tab integer,enabled integer);`,
      )
    }
    sqlite.exec(
      "INSERT INTO navigation_primary VALUES(1,1,'first','First','internal',5,NULL,0,1),(2,1,'second','Second','external',NULL,'https://example.com',1,0); INSERT INTO navigation_primary_children VALUES(1,'first','child','Child','external',NULL,'https://example.org',1,1); INSERT INTO navigation_footer VALUES(1,1,'footer','Footer','external',NULL,'https://example.net',0,1);",
    )
    const compile = (statement: SQL) =>
      statement.toQuery({
        escapeName: (name: string) => `"${name}"`,
        escapeParam: () => '?',
        escapeString: (value: string) => `'${value.replaceAll("'", "''")}'`,
      } as never)
    const db = {
      run: async (statement: SQL) => {
        const query = compile(statement)
        if (query.params.length) sqlite.prepare(query.sql).run(...(query.params as never[]))
        else sqlite.exec(query.sql)
      },
      all: async (statement: SQL) => {
        const query = compile(statement)
        return sqlite.prepare(query.sql).all(...(query.params as never[]))
      },
    }
    await up({ db } as never)
    const menus = sqlite.prepare('SELECT * FROM menus ORDER BY id').all() as Array<{
      id: number
      name: string
      items: string
    }>
    expect(menus.map((menu) => menu.name)).toEqual(['Primary', 'Footer'])
    expect(JSON.parse(menus[0].items)).toEqual([
      {
        key: 'primary-0',
        parent: null,
        label: 'First',
        kind: 'page',
        target: 5,
        enabled: true,
        newTab: false,
      },
      {
        key: 'primary-0-0',
        parent: 'primary-0',
        label: 'Child',
        kind: 'custom',
        url: 'https://example.org',
        enabled: true,
        newTab: true,
      },
      {
        key: 'primary-1',
        parent: null,
        label: 'Second',
        kind: 'custom',
        url: 'https://example.com',
        enabled: false,
        newTab: true,
      },
    ])
    sqlite
      .prepare('UPDATE menus SET name=?,items=?,revision=revision+1 WHERE id=?')
      .run('Edited', '[]', menus[0].id)
    await up({ db } as never)
    expect(sqlite.prepare('SELECT name,items FROM menus WHERE id=?').get(menus[0].id)).toEqual({
      name: 'Edited',
      items: '[]',
    })
    expect(sqlite.prepare('SELECT count(*) total FROM menus').get()).toEqual({ total: 2 })
    expect(sqlite.prepare('SELECT updated_at,created_at FROM navigation').get()).toEqual({
      updated_at: 'unchanged',
      created_at: 'original',
    })
    expect(sqlite.prepare('SELECT count(*) total FROM navigation_primary').get()).toEqual({
      total: 2,
    })
    expect(sqlite.prepare('SELECT title FROM pages').get()).toEqual({ title: 'Preserved page' })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    await expect(down({} as never)).rejects.toThrow('recovery point')
    sqlite.close()
  })
})
