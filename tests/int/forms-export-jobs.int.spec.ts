import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Payload } from 'payload'
import { statements } from '@/migrations/20261012_200651_forms_module'
import { generateExport } from '@/forms/exports'
import type { FormPlatform } from '@/forms/platform'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  for (const sql of statements.filter(sql => /^CREATE TABLE `form_exports`/.test(sql))) sqlite.exec(sql)
  sqlite.exec('CREATE TABLE form_submissions (id integer, site text, form_id integer, answers text, schema_snapshot text, revision text, workflow_status text, created_at text)')
  const snapshot = JSON.stringify({ title: 'Original form', fields: [{ id: 'name', kind: 'text', label: 'Original name' }] })
  sqlite.prepare('INSERT INTO form_submissions VALUES (1,?,?,?,?,?,?,?)').run('default', 1, JSON.stringify({ name: 'Example' }), snapshot, 'old-revision', 'received', '2026-01-02T00:00:00.000Z')
  sqlite.prepare("INSERT INTO form_exports (id,site,requested_by,status,format,columns,filters) VALUES (1,'default','7','pending','csv',?,?)").run(JSON.stringify(['entryID', 'revision', 'field:name']), JSON.stringify({ formID: 1, from: '2026-01-01', to: '2026-02-01', maxID: 1, sensitive: false }))
  const objects = new Map<string, Uint8Array>()
  const db = { prepare(sql: string) {
    let args: (string | number | null)[] = []
    const statement = {
      bind(...values: (string | number | null)[]) { args = values; return statement },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } } },
      async first() { return sqlite.prepare(sql).get(...args) || null },
      async all() { return { results: sqlite.prepare(sql).all(...args) } },
    }
    return statement
  } } as unknown as D1Database
  const platform = { db, storage: { async put(key: string, bytes: Uint8Array) { objects.set(key, bytes) }, async delete(key: string) { objects.delete(key) } } } as unknown as FormPlatform
  const payload = { findByID: async () => ({ id: 7, role: 'administrator' }) } as unknown as Payload
  return { sqlite, objects, platform, payload }
}
describe('private export jobs', () => {
  it('paginates larger exports without dropping or duplicating rows', async () => {
    const f = fixture(), template = f.sqlite.prepare('SELECT * FROM form_submissions').get()!
    const insert = f.sqlite.prepare('INSERT INTO form_submissions VALUES (?,?,?,?,?,?,?,?)')
    f.sqlite.exec('BEGIN')
    for (let id = 2; id <= 1200; id++) insert.run(id, 'default', 1, template.answers, template.schema_snapshot, template.revision, template.workflow_status, template.created_at)
    f.sqlite.exec('COMMIT')
    f.sqlite.prepare("UPDATE form_exports SET filters=json_set(filters,'$.maxID',1200)").run()
    await generateExport(f.platform, f.payload, 'default', 1)
    const file = [...f.objects.values()][0]
    const lines = new TextDecoder().decode(file).trim().split('\r\n')
    expect(lines).toHaveLength(1201)
    expect(lines[1200]).toBe('"1200","old-revision","Example"')
    f.sqlite.close()
  })
  it('generates a private expiring file once, using the requested revision and columns', async () => {
    const f = fixture()
    await generateExport(f.platform, f.payload, 'default', 1)
    const row = f.sqlite.prepare('SELECT * FROM form_exports').get()!
    expect(row.status).toBe('complete')
    expect(String(row.object_key)).toMatch(/^form-private\/default\/exports\/1\//)
    expect(Date.parse(String(row.expires_at))).toBeGreaterThan(Date.now())
    expect(new TextDecoder().decode(f.objects.get(String(row.object_key)))).toContain('"1","old-revision","Example"')
    await generateExport(f.platform, f.payload, 'default', 1)
    expect(f.objects.size).toBe(1)
    f.sqlite.close()
  })
  it('rechecks current permissions and reports configured size limits without partial downloads', async () => {
    const f = fixture()
    await generateExport(f.platform, { findByID: async () => ({ id: 7, role: 'editor' }) } as unknown as Payload, 'default', 1)
    expect(f.sqlite.prepare('SELECT status,error FROM form_exports').get()).toMatchObject({ status: 'failed', error: 'Export permissions changed. Ask an administrator to review access.' })
    expect(f.objects.size).toBe(0)
    f.sqlite.prepare("UPDATE form_exports SET status='pending'").run()
    f.platform.exportLimits = { bytes: 1 }
    await generateExport(f.platform, f.payload, 'default', 1)
    expect(String(f.sqlite.prepare('SELECT error FROM form_exports').get()?.error)).toContain('size limit')
    expect(f.objects.size).toBe(0)
    f.sqlite.close()
  })
})
