# Private CRM attachments

Open an existing contact and choose **Private attachments**. Select the information category, choose a supported file up to 25 MiB, then upload. Access requires both the linked CRM record's permissions and the file's category. Contact files require communications access as well as identity read access; a financial category additionally requires finance access. Filenames, lists and downloads use those same checks.

Files are stored in the existing private `WORKSPACE_FILES` bucket. Download responses use attachment disposition and octet-stream content. Object keys are never returned by the CRM API. Immutable metadata retains the original filename, category, content checksum, linked record and uploader. Replacing content means uploading a separate file.

An interrupted staged upload can be resumed for 24 hours by selecting the original file. The server checks its length, checksum and supported binary signature. A lost upload acknowledgement can be retried without replacing stored bytes or duplicating publication. Pending uploads can be cancelled by their uploader.

Archive hides a published file from the active list. The archived view retains download and restore actions for authorized staff. Published and archived content remains retained. The protected CRM scheduler expires abandoned staged uploads and performs bounded, resumable cleanup of known unpublished expired/cancelled objects. It preserves unknown objects and files outside its namespace.

The shared reference layer also supports households, gifts, pledges, recurring schedules, membership terms, opportunities and volunteer activities. The initial staff screen is attached to contact views. Placement in other domain editors and unified contact timelines remain implementation-plan items. Existing Tasks/Boards continue using their existing attachment infrastructure until the planned CRM-linked permission intersection is implemented.

The version-one record predicates used by attachment migration triggers are frozen in `src/crm/record-context-v1.ts`. Changes to reference resolution or merge lineage require a new reviewed migration/version rather than silently changing an already-deployed migration.
