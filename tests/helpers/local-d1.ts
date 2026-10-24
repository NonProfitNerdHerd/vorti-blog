import { DatabaseSync } from 'node:sqlite'
/** Fast real SQLite queries/transactions for repository cases; Worker integration additionally runs on workerd D1. */
export function localD1() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  class Statement {
    constructor(
      readonly sql: string,
      readonly values: Array<string | number | null> = [],
    ) {}
    bind(...values: Array<string | number | null>) {
      return new Statement(this.sql, values)
    }
    async first(column?: string) {
      const row = sqlite.prepare(this.sql).get(...this.values)
      return row ? (column ? row[column] : row) : null
    }
    async all() {
      return {
        success: true,
        results: sqlite.prepare(this.sql).all(...this.values),
        meta: { changes: 0 },
      }
    }
    async run() {
      const result = sqlite.prepare(this.sql).run(...this.values)
      return {
        success: true,
        results: [] as never[],
        meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
      }
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  return { db, sqlite, close: () => sqlite.close() }
}
