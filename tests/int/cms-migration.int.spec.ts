import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { up, down } from '@/migrations/20261020_180749_simplify_cms'
import { up as cleanViews } from '@/migrations/20261020_183100_saved_view_content_cleanup'

type Table = { columns: Record<string, { type: string; primaryKey?: boolean; notNull?: boolean; default?: unknown }>; foreignKeys: Record<string, { columnsFrom: string[]; columnsTo: string[]; tableTo: string; onDelete: string }> }
const schema = JSON.parse(readFileSync('src/migrations/20261020_170954_reusable_menus.json', 'utf8')) as { tables: Record<string, Table> }
const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`
describe('Targeted CMS schema cleanup', () => {
  it('removes retired Saved View filters while preserving other rules and versions', async () => {
    const database = new DatabaseSync(':memory:')
    database.exec('CREATE TABLE saved_views(id integer,configuration text); CREATE TABLE _saved_views_v(id integer,version_configuration text);')
    const configuration = { version: 1, layout: 'grid-1', query: { source: 'posts', postTypes: ['1'], limit: 12, rules: [{ field: 'categories', operator: 'any', values: ['7'] }, { field: 'postType', operator: 'any', values: ['1'] }] } }
    database.prepare('INSERT INTO saved_views VALUES(1,?)').run(JSON.stringify(configuration))
    database.prepare('INSERT INTO _saved_views_v VALUES(1,?)').run(JSON.stringify(configuration))
    const db = { run: async (statement: { queryChunks: { value: string[] }[] }) => database.exec(statement.queryChunks.map(chunk => chunk.value.join('')).join('')) }
    try {
      await cleanViews({ db } as never)
      await cleanViews({ db } as never)
      const expected = { ...configuration, query: { source: 'posts', limit: 12, rules: [configuration.query.rules[0]] } }
      expect(JSON.parse(String(database.prepare('SELECT configuration FROM saved_views').get()!.configuration))).toEqual(expected)
      expect(JSON.parse(String(database.prepare('SELECT version_configuration FROM _saved_views_v').get()!.version_configuration))).toEqual(expected)
    } finally { database.close() }
  })
  it('cleans an older development database without rebuilding unrelated tables', async () => {
    const database = new DatabaseSync(':memory:')
    database.exec("CREATE TABLE posts(id integer PRIMARY KEY,title text); CREATE TABLE _posts_v(id integer PRIMARY KEY); CREATE TABLE payload_locked_documents_rels(id integer PRIMARY KEY); CREATE TABLE post_types(id integer PRIMARY KEY); CREATE TABLE task_boards(id integer PRIMARY KEY,name text); INSERT INTO task_boards VALUES(1,'Keep');")
    const command = (statement: { queryChunks: { value: string[] }[] }) => statement.queryChunks.map(chunk => chunk.value.join('')).join('')
    const db = { run: async (statement: Parameters<typeof command>[0]) => database.exec(command(statement)), all: async (statement: Parameters<typeof command>[0]) => database.prepare(command(statement)).all() }
    try {
      await up({ db } as never)
      await up({ db } as never)
      expect(database.prepare('SELECT name FROM task_boards').get()).toEqual({ name: 'Keep' })
      expect(database.prepare('PRAGMA table_info(posts)').all().map(row => row.name)).toEqual(['id', 'title', 'template_snapshot', 'event'])
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='post_types'").all()).toEqual([])
    } finally { database.close() }
  })
  it.each([false, true])('preserves workspace and shared data, D1 foreign-key behavior=%s', async d1 => {
    const database = new DatabaseSync(':memory:')
    database.exec('PRAGMA foreign_keys=ON')
    for (const [name, table] of Object.entries(schema.tables)) {
      const columns = Object.entries(table.columns).map(([name, col]) => `${quoted(name)} ${col.type}${col.primaryKey ? ' PRIMARY KEY' : ''}${col.notNull ? ' NOT NULL' : ''}${col.default !== undefined ? ` DEFAULT ${col.default}` : ''}`)
      const keys = Object.values(table.foreignKeys).map(key => `FOREIGN KEY (${key.columnsFrom.map(quoted).join(',')}) REFERENCES ${quoted(key.tableTo)}(${key.columnsTo.map(quoted).join(',')}) ON DELETE ${key.onDelete}`)
      database.exec(`CREATE TABLE ${quoted(name)}(${[...columns, ...keys].join(',')})`)
    }
    const insert = (table: string, values: Record<string, unknown>) => {
      const data = { ...Object.fromEntries(Object.entries(schema.tables[table].columns).filter(([key, col]) => col.notNull && col.default === undefined && !(key in values)).map(([key, col]) => [key, col.type === 'text' ? `${table}-${key}` : 1])), ...values }
      database.prepare(`INSERT INTO ${quoted(table)}(${Object.keys(data).map(quoted).join(',')}) VALUES(${Object.keys(data).map(() => '?').join(',')})`).run(...Object.values(data) as never[])
    }
    insert('users', { id: 1, email: 'preserve@example.invalid' })
    insert('media', { id: 1 })
    insert('pages', { id: 1, title: 'Preserved page' })
    insert('post_types', { id: 1 })
    insert('posts', { id: 1, title: 'CMS Post', post_type_id: 1 })
    insert('_posts_v', { id: 1, parent_id: 1, version_post_type_id: 1 })
    insert('task_projects', { id: 1, name: 'Preserve project', owner_id: 1 })
    insert('task_boards', { id: 1, name: 'Preserve board', owner_id: 1, project_id: 1 })
    insert('review_tasks', { id: 1, title: 'Preserve task', creator_id: 1, document_type: 'posts', document_i_d: '1' })
    insert('review_comments', { id: 1, task_id: 1, author_id: 1, body: 'Preserve discussion' })
    insert('task_placements', { id: 1, task_id: 1, board_id: 1 })
    insert('event_series', { id: 1, post_id: 1, start: '2026-10-01', end: '2026-10-02', schedule: '{}' })
    insert('payload_locked_documents', { id: 1 })
    insert('payload_locked_documents_rels', { id: 1, parent_id: 1, task_boards_id: 1 })
    const names = ['users', 'media', 'pages', 'task_projects', 'task_boards', 'review_tasks', 'review_comments', 'task_placements', 'event_series']
    const before = names.map(name => database.prepare(`SELECT * FROM ${name}`).all())
    const commandOf = (statement: { queryChunks: { value: string[] }[] }) => statement.queryChunks.map(chunk => chunk.value.join('')).join('')
    const db = { all: async (statement: { queryChunks: { value: string[] }[] }) => database.prepare(commandOf(statement)).all(), run: async (statement: { queryChunks: { value: string[] }[] }) => {
      const command = statement.queryChunks.map(chunk => chunk.value.join('')).join('')
      if (d1 && /PRAGMA foreign_keys=OFF/.test(command)) return
      database.exec(command)
    } }
    try {
      await up({ db } as never)
      expect(names.map(name => database.prepare(`SELECT * FROM ${name}`).all())).toEqual(before)
      expect(database.prepare('SELECT parent_id FROM _posts_v WHERE id=1').get()).toEqual({ parent_id: 1 })
      expect(database.prepare('SELECT task_boards_id FROM payload_locked_documents_rels WHERE id=1').get()).toEqual({ task_boards_id: 1 })
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%post_types%'").all()).toEqual([])
      expect(database.prepare('PRAGMA table_info(posts)').all().map(row => row.name)).not.toContain('post_type_id')
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      await expect(down({ db } as never)).rejects.toThrow('recovery point')
    } finally { database.close() }
  })
})
