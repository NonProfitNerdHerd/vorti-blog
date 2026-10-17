import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`system_settings\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`categories_enabled\` integer DEFAULT true,
    \`updated_at\` text,
    \`created_at\` text
  );
  `)
  await db.run(sql`INSERT INTO \`system_settings\` (\`id\`, \`categories_enabled\`, \`created_at\`, \`updated_at\`)
    VALUES (1, true, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`system_settings\`;`)
}
