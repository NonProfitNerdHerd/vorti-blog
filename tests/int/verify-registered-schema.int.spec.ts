import { expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { verifyRegisteredSchema } from '../../scripts/lib/verify-registered-schema'

it('only inspects an exact ledger and foreign keys without changing the database', async () => {
  const f = localD1()
  try {
    f.sqlite.exec(
      "CREATE TABLE payload_migrations(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO payload_migrations VALUES(1,'first'),(2,'second')",
    )
    const before = f.sqlite.prepare('SELECT total_changes() n').get()!.n
    expect(await verifyRegisteredSchema(f.db, ['first', 'second'])).toEqual({
      codeOnly: true,
      applied: [],
      total: 2,
    })
    expect(f.sqlite.prepare('SELECT total_changes() n').get()!.n).toBe(before)
    await expect(verifyRegisteredSchema(f.db, ['second', 'first'])).rejects.toThrow(
      'exact registered',
    )
    await expect(verifyRegisteredSchema(f.db, ['first'])).rejects.toThrow('exact registered')
    f.sqlite.exec(
      'PRAGMA foreign_keys=OFF; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent INTEGER REFERENCES parent(id)); INSERT INTO child VALUES(99); PRAGMA foreign_keys=ON',
    )
    await expect(verifyRegisteredSchema(f.db, ['first', 'second'])).rejects.toThrow('foreign keys')
  } finally {
    f.close()
  }
})
