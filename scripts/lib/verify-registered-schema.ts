/** Code-only releases inspect the ledger and integrity without migrating,
 * converting content, seeding records, or removing the write freeze. */
export async function verifyRegisteredSchema(db: D1Database, registered: string[]) {
  const ledger = (
    await db.prepare('SELECT name FROM payload_migrations ORDER BY id').all<{ name: string }>()
  ).results.map((row) => row.name)
  if (JSON.stringify(ledger) !== JSON.stringify(registered))
    throw Error('Code-only deployment requires the exact registered migration chain.')
  if ((await db.prepare('PRAGMA foreign_key_check').all()).results.length)
    throw Error('Code-only deployment requires clean foreign keys.')
  return { codeOnly: true, applied: [] as string[], total: ledger.length }
}
