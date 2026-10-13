# Forms release scope

The user's revised instruction supersedes the original 20-section Forms brief.

Deliver and deploy:

- Visual field creation, configuration, arrangement and validation.
- Draft saving, preview and publication.
- Form placement on existing pages.
- Reliable, validated and idempotent submission acceptance.
- Private entry viewing and configurable notifications.
- Protection through existing CMS roles and administrator access.

Retain existing stable implementations for progress/resume, uploads, booking,
analytics, surveys, export/receipts, sharing/embeds, test payments, CMS record
actions and JSON transfer. Verify retained paths; do not expand their feature sets.

Exclude public account registration, new roles or site-wide permission systems,
reusable template/group libraries, additional theming, and unfinished provider
options. Remove their unfinished UI rather than representing them as functional.
Preserve unrelated files and existing production content.

Release authorization includes commit, push to main, additive production migration,
and deployment to the existing Worker. Record a recovery bookmark, review migration
SQL, and validate the Worker before release. External delivery must be reported
as unconfigured unless a real provider is configured; local captures are not sent mail.

The older forms-implementation.md is a chronological engineering log, not the
current scope or a promise to implement its unfinished items.
