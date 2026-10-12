import type { Plugin } from 'payload'
import { reviewDocuments } from './documents'
import { sql } from '@payloadcms/db-d1-sqlite'

export const documentReview: Plugin = (config) => {
  for (const collection of config.collections ?? []) {
    if (!reviewDocuments.includes(collection.slug as (typeof reviewDocuments)[number])) continue
    collection.admin ??= {}
    collection.admin.components ??= {}
    collection.admin.components.edit ??= {}
    collection.admin.components.edit.beforeDocumentControls = [
      ...(collection.admin.components.edit.beforeDocumentControls ?? []),
      './review/TaskDocument#TaskDocument',
    ]
    collection.hooks ??= {}
    collection.hooks.afterDelete = [
      ...(collection.hooks.afterDelete ?? []),
      async ({ id, req }) => {
        // Preserve the original document reference/title while making orphaned
        // history administrator-only. These tables are an internal allowlist.
        for (const table of ['review_tasks', 'review_comments', 'review_activity']) {
          await req.payload.db.drizzle.run(
            sql`UPDATE ${sql.raw(table)} SET document_deleted = 1 WHERE document_type = ${collection.slug} AND document_i_d = ${String(id)}`,
          )
        }
      },
    ]
  }
  return config
}
