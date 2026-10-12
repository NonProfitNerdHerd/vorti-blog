import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

// Additive schema captured from Payload's generated local D1 schema.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql.raw(
      "CREATE TABLE `review_tasks` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`title` text NOT NULL,\n\t`description` text,\n\t`document_type` text NOT NULL,\n\t`document_i_d` text NOT NULL,\n\t`document_deleted` integer DEFAULT false,\n\t`document_title` text,\n\t`region` text DEFAULT 'document',\n\t`parent_id` integer,\n\t`status` text DEFAULT 'open' NOT NULL,\n\t`priority` text DEFAULT 'normal' NOT NULL,\n\t`assignee_id` integer,\n\t`due_date` text,\n\t`creator_id` integer,\n\t`archived` integer DEFAULT false,\n\t`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,\n\t`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,\n\tFOREIGN KEY (`parent_id`) REFERENCES `review_tasks`(`id`) ON UPDATE no action ON DELETE set null,\n\tFOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,\n\tFOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null\n);",
    ),
  )
  await db.run(
    sql.raw('CREATE INDEX `review_tasks_document_type_idx` ON `review_tasks` (`document_type`);'),
  )
  await db.run(
    sql.raw('CREATE INDEX `review_tasks_document_i_d_idx` ON `review_tasks` (`document_i_d`);'),
  )
  await db.run(sql.raw('CREATE INDEX `review_tasks_parent_idx` ON `review_tasks` (`parent_id`);'))
  await db.run(sql.raw('CREATE INDEX `review_tasks_status_idx` ON `review_tasks` (`status`);'))
  await db.run(
    sql.raw('CREATE INDEX `review_tasks_assignee_idx` ON `review_tasks` (`assignee_id`);'),
  )
  await db.run(sql.raw('CREATE INDEX `review_tasks_creator_idx` ON `review_tasks` (`creator_id`);'))
  await db.run(sql.raw('CREATE INDEX `review_tasks_archived_idx` ON `review_tasks` (`archived`);'))
  await db.run(
    sql.raw('CREATE INDEX `review_tasks_updated_at_idx` ON `review_tasks` (`updated_at`);'),
  )
  await db.run(
    sql.raw('CREATE INDEX `review_tasks_created_at_idx` ON `review_tasks` (`created_at`);'),
  )
  await db.run(
    sql.raw(
      "CREATE TABLE `review_comments` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`task_id` integer NOT NULL,\n\t`document_type` text NOT NULL,\n\t`document_i_d` text NOT NULL,\n\t`document_deleted` integer DEFAULT false,\n\t`author_id` integer,\n\t`body` text NOT NULL,\n\t`moderated` integer DEFAULT false,\n\t`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,\n\t`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,\n\tFOREIGN KEY (`task_id`) REFERENCES `review_tasks`(`id`) ON UPDATE no action ON DELETE set null,\n\tFOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null\n);",
    ),
  )
  await db.run(sql.raw('CREATE INDEX `review_comments_task_idx` ON `review_comments` (`task_id`);'))
  await db.run(
    sql.raw(
      'CREATE INDEX `review_comments_document_type_idx` ON `review_comments` (`document_type`);',
    ),
  )
  await db.run(
    sql.raw(
      'CREATE INDEX `review_comments_document_i_d_idx` ON `review_comments` (`document_i_d`);',
    ),
  )
  await db.run(
    sql.raw('CREATE INDEX `review_comments_author_idx` ON `review_comments` (`author_id`);'),
  )
  await db.run(
    sql.raw('CREATE INDEX `review_comments_updated_at_idx` ON `review_comments` (`updated_at`);'),
  )
  await db.run(
    sql.raw('CREATE INDEX `review_comments_created_at_idx` ON `review_comments` (`created_at`);'),
  )
  await db.run(
    sql.raw(
      "CREATE TABLE `review_activity` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`task_id` integer NOT NULL,\n\t`document_type` text NOT NULL,\n\t`document_i_d` text NOT NULL,\n\t`document_deleted` integer DEFAULT false,\n\t`actor_id` integer,\n\t`message` text NOT NULL,\n\t`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,\n\t`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,\n\tFOREIGN KEY (`task_id`) REFERENCES `review_tasks`(`id`) ON UPDATE no action ON DELETE set null,\n\tFOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null\n);",
    ),
  )
  await db.run(sql.raw('CREATE INDEX `review_activity_task_idx` ON `review_activity` (`task_id`);'))
  await db.run(
    sql.raw(
      'CREATE INDEX `review_activity_document_type_idx` ON `review_activity` (`document_type`);',
    ),
  )
  await db.run(
    sql.raw(
      'CREATE INDEX `review_activity_document_i_d_idx` ON `review_activity` (`document_i_d`);',
    ),
  )
  await db.run(
    sql.raw('CREATE INDEX `review_activity_actor_idx` ON `review_activity` (`actor_id`);'),
  )
  await db.run(
    sql.raw('CREATE INDEX `review_activity_updated_at_idx` ON `review_activity` (`updated_at`);'),
  )
  await db.run(
    sql.raw('CREATE INDEX `review_activity_created_at_idx` ON `review_activity` (`created_at`);'),
  )
  await db.run(
    sql.raw(
      'ALTER TABLE payload_locked_documents_rels ADD COLUMN review_tasks_id integer REFERENCES review_tasks(id) ON DELETE cascade;',
    ),
  )
  await db.run(
    sql.raw(
      'CREATE INDEX payload_locked_documents_rels_review_tasks_id_idx ON payload_locked_documents_rels (review_tasks_id);',
    ),
  )
  await db.run(
    sql.raw(
      'ALTER TABLE payload_locked_documents_rels ADD COLUMN review_comments_id integer REFERENCES review_comments(id) ON DELETE cascade;',
    ),
  )
  await db.run(
    sql.raw(
      'CREATE INDEX payload_locked_documents_rels_review_comments_id_idx ON payload_locked_documents_rels (review_comments_id);',
    ),
  )
  await db.run(
    sql.raw(
      'ALTER TABLE payload_locked_documents_rels ADD COLUMN review_activity_id integer REFERENCES review_activity(id) ON DELETE cascade;',
    ),
  )
  await db.run(
    sql.raw(
      'CREATE INDEX payload_locked_documents_rels_review_activity_id_idx ON payload_locked_documents_rels (review_activity_id);',
    ),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql.raw('DROP INDEX payload_locked_documents_rels_review_activity_id_idx'))
  await db.run(sql.raw('ALTER TABLE payload_locked_documents_rels DROP COLUMN review_activity_id'))
  await db.run(sql.raw('DROP TABLE review_activity'))
  await db.run(sql.raw('DROP INDEX payload_locked_documents_rels_review_comments_id_idx'))
  await db.run(sql.raw('ALTER TABLE payload_locked_documents_rels DROP COLUMN review_comments_id'))
  await db.run(sql.raw('DROP TABLE review_comments'))
  await db.run(sql.raw('DROP INDEX payload_locked_documents_rels_review_tasks_id_idx'))
  await db.run(sql.raw('ALTER TABLE payload_locked_documents_rels DROP COLUMN review_tasks_id'))
  await db.run(sql.raw('DROP TABLE review_tasks'))
}
