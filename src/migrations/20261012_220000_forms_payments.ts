import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { paymentSQL } from '../forms/payments'

/** Additive for development databases initialized before the payment ledger was introduced. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of paymentSQL) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Payment history must be retained. Restore a reviewed backup instead of deleting payment records.')
}
