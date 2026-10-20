# Posts, Templates, and Saved Views

Posts are the main content records. Pages remain separate. There is no Post Types collection or content-type registry.

## Create a Post

Every new Post editor opens **Select a template**. Select a named template or **Blank** in the same dropdown, then choose **Create Post**. No Post is written until you save through the normal draft/publish controls. Cancel returns to Posts without creating a record.

The small **Create a Template** icon opens the existing template editor in a document drawer. Saving returns to the chooser with the saved template selected. Closing the drawer retains the previous selection. Template creation permissions are unchanged.

A template-based Post stores a server-created snapshot of its template definition and referenced block types/designs, together with independent field values. Source-template changes do not replace existing Post content. The snapshot remains usable after the source template is removed. Blank Posts use the existing freeform block editor. Pages keep their existing template behavior.

## Events and reusable listings

Optional event information is stored directly on Posts. It retains recurrence, timezone handling, exceptions and the published event-series projection. Events use ordinary `/posts/{slug}` URLs. Saved Views continue supplying content and event layouts, taxonomy filters, search and pagination, without a Post Type selector. Forms create ordinary draft Posts using their existing approval and access checks.

## Database cleanup

`20261020_180749_simplify_cms` removes `post_types`, its relationship table, version tables, Post Type columns on Posts/versions and the obsolete editing-lock relationship. It preserves existing Posts and their remaining fields, Pages, shared media, users and workspace records. Retired structured Post Type values are removed. The migration temporarily copies affected relationships to preserve them when D1 applies foreign-key delete actions during table reconstruction.

Rollbacks require the recorded database recovery point; removed content-type definitions cannot be reconstructed by a down migration.

`20261020_183100_saved_view_content_cleanup` removes retired Post Type filters from Saved Views and their versions while preserving other query rules and presentation settings.

## Extensions

Server code imports contracts from `@design-system/payload-design-core`. Browser components import `/content` or `/admin` so server dependencies do not enter client bundles.
