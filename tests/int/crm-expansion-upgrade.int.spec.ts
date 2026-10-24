import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect } from 'vitest'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import * as households from '../../src/migrations/20261024_140000_crm_households'
import * as fundraising from '../../src/migrations/20261024_150000_crm_fundraising'
import * as activities from '../../src/migrations/20261024_160000_crm_activities'
import * as jobs from '../../src/migrations/20261024_170000_crm_jobs'
import * as commitments from '../../src/migrations/20261024_180000_crm_commitments'
import * as memberships from '../../src/migrations/20261024_190000_crm_memberships'
import * as opportunities from '../../src/migrations/20261024_200000_crm_opportunities'
import * as volunteers from '../../src/migrations/20261024_210000_crm_volunteers'
type RawStatement = {
  toQuery(config: {
    escapeName: (value: string) => string
    escapeParam: () => string
    escapeString: (value: string) => string
  }): { sql: string; params: unknown[] }
}

describe('additive CRM expansion migrations', () => {
  it('runs the real upgrade functions twice while preserving earlier tables and values', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(
        "PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT); INSERT INTO users VALUES(1,'administrator'); CREATE TABLE historical_content(id INTEGER PRIMARY KEY,body TEXT); INSERT INTO historical_content VALUES(7,'Keep published body and relationships');",
      )
      for (const statement of [
        ...organizationSchema,
        ...defaultOrganizationSeed,
        ...contactSchemaV1,
        ...financeSchemaV1,
      ])
        sqlite.exec(statement)
      sqlite.exec(
        "INSERT INTO vc_crm_funds(id,site_id,name,created_at,updated_at) VALUES('historical-fund','default','Retain fund','2026-01-01','2026-01-01')",
      )
      const before = new Map(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((row) => {
            const name = String(row.name)
            return [
              name,
              sqlite.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`).get()!.n,
            ]
          }),
      )
      const compile = (statement: RawStatement) =>
        statement.toQuery({
          escapeName: (value) => `"${value.replaceAll('"', '""')}"`,
          escapeParam: () => '?',
          escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
        })
      const args = {
        db: {
          run: async (statement: RawStatement) => {
            const query = compile(statement)
            return sqlite.prepare(query.sql).run(...(query.params as Array<string | number | null>))
          },
          all: async (statement: RawStatement) => {
            const query = compile(statement)
            return sqlite.prepare(query.sql).all(...(query.params as Array<string | number | null>))
          },
        },
      } as unknown as Parameters<typeof households.up>[0]
      for (let repeat = 0; repeat < 2; repeat++)
        for (const migration of [
          households,
          fundraising,
          activities,
          jobs,
          commitments,
          memberships,
          opportunities,
          volunteers,
        ])
          await migration.up(args)
      for (const [table, count] of before)
        expect(
          sqlite.prepare(`SELECT count(*) AS n FROM "${table.replaceAll('"', '""')}"`).get()!.n,
        ).toBe(count)
      expect(
        sqlite
          .prepare("SELECT name,description FROM vc_crm_funds WHERE id='historical-fund'")
          .get(),
      ).toEqual({ name: 'Retain fund', description: '' })
      expect(sqlite.prepare('SELECT body FROM historical_content WHERE id=7').get()!.body).toBe(
        'Keep published body and relationships',
      )
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      sqlite.close()
    }
  })
})
