import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { PayloadRequest } from 'payload'
import { emptyDefinition } from '../../packages/payload-design-core/src/forms/model'
import { formSurveyEndpoints } from '@/forms/surveys'
import type { FormPlatform } from '@/forms/platform'
import type { SurveyFieldSummary } from '../../packages/payload-design-core/src/forms/survey'
import { withAuthority } from '../../src/organizations/claims'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    'CREATE TABLE form_submissions(id INTEGER PRIMARY KEY,site TEXT,form_id INTEGER,revision TEXT,created_at TEXT,spam INTEGER,archived INTEGER,answers TEXT)',
  )
  const definition = emptyDefinition()
  definition.fields = [
    { id: 'score', kind: 'nps', label: 'Recommend' },
    { id: 'private', kind: 'rating', label: 'Secret', sensitive: true },
  ]
  const form = {
    id: 1,
    site: 'default',
    _status: 'published',
    publishedRevision: 'current',
    archived: false,
  }
  const snapshot = { definition, title: 'Survey', retiredAt: null as string | null }
  const queries: unknown[] = []
  const db = {
    prepare(sql: string) {
      let args: (string | number)[] = []
      const statement = {
        bind(...values: (string | number)[]) {
          args = values
          return statement
        },
        async first() {
          return sqlite.prepare(sql).get(...args)
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...args) }
        },
      }
      return statement
    },
  } as unknown as D1Database
  const handler = formSurveyEndpoints({ db } as FormPlatform)[0].handler
  const request = async (query = '', role?: string, scoped = true) =>
    handler({
      routeParams: { id: '1' },
      url: `http://localhost/api/forms-surveys/1${query}`,
      user: role
        ? scoped
          ? withAuthority(
              { id: 7, role },
              {
                actor: 7,
                site: 'default',
                organization: 'fictional-survey-root',
                epoch: 1,
                operator: false,
                bootstrap: false,
                allowed: { 'form-submissions': ['read'] },
              },
            )
          : { id: 7, role }
        : undefined,
      payload: {
        find: async (options: { collection: string }) => {
          queries.push(options)
          return { docs: options.collection === 'forms' ? [form] : [snapshot] }
        },
      },
    } as unknown as PayloadRequest)
  const insert = (id: number, site = 'default', revision = 'current', spam = 0, archived = 0) =>
    sqlite
      .prepare('INSERT INTO form_submissions VALUES (?,?,?,?,?,?,?,?)')
      .run(
        id,
        site,
        1,
        revision,
        '2026-01-02T00:00:00.000Z',
        spam,
        archived,
        JSON.stringify({ score: 10, private: 5 }),
      )
  return { sqlite, definition, form, snapshot, queries, request, insert }
}
describe('survey endpoint boundaries', () => {
  it('requires published opt-in and excludes other sites, revisions, spam, archives, and sensitive answers', async () => {
    const f = fixture()
    try {
      expect((await f.request()).status).toBe(403)
      f.definition.access.publicResults = true
      for (let id = 1; id <= 105; id++) f.insert(id)
      f.insert(106, 'other')
      f.insert(107, 'default', 'old')
      f.insert(108, 'default', 'current', 1)
      f.insert(109, 'default', 'current', 0, 1)
      const response = await f.request(),
        data = (await response.json()) as { entries: number; fields: SurveyFieldSummary[] }
      expect(response.status).toBe(200)
      expect(data.entries).toBe(105)
      expect(data.fields).toHaveLength(1)
      expect(data.fields[0]).toMatchObject({ responses: 105, nps: 100 })
      expect(JSON.stringify(data)).not.toContain('Secret')
      expect(f.queries[0]).toMatchObject({ draft: false, overrideAccess: true })
      expect((await f.request('?revision=old')).status).toBe(400)
      expect((await f.request('?from=2026-01-01')).status).toBe(400)
      f.form.site = 'other'
      expect((await f.request()).status).toBe(404)
    } finally {
      f.sqlite.close()
    }
  })
  it('holds small public cohorts, honors authenticated access, and permits scoped staff reporting', async () => {
    const f = fixture()
    try {
      f.definition.access.publicResults = true
      f.insert(1)
      expect(await (await f.request()).json()).toMatchObject({ pending: true, fields: [] })
      f.definition.access.authenticated = true
      expect((await f.request()).status).toBe(403)
      f.definition.access.publicResults = false
      expect((await f.request('', 'editor', false)).status).toBe(403)
      const staff = (await (
        await f.request('?from=2026-01-01&to=2026-02-01', 'editor')
      ).json()) as { entries: number }
      expect(staff.entries).toBe(1)
      expect((await f.request('?from=bad', 'editor')).status).toBe(400)
      f.form.archived = true
      expect((await f.request()).status).toBe(404)
      expect((await f.request('', 'editor')).status).toBe(200)
    } finally {
      f.sqlite.close()
    }
  })
})
