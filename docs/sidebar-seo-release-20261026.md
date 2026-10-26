# Sidebar and SEO production release — 2026-10-26

Production: https://vorti-blog.ike-j-rebout.workers.dev/admin

The sidebar order is Dashboard, Tasks, Content, CRM, Forms, Workflows, Site Design, Admin. Inbox is the first Tasks child and displays its authenticated unread count, including zero after a successful response; large counts display 99+ with the full count accessible. Its existing polling and read-action refresh behavior remain in use, and badge styling now loads throughout the admin.

The legacy `standard-article` template is excluded from new article choices and template selections. Its stored definition, existing references, snapshots and rendering are retained. Other templates, including Events and Blank, remain available.

Post/Page inspectors now have Block, Post/Page and SEO tabs. The existing SEO overview, title, description, image, generation controls and preview render in SEO rather than the document tab. Expand shows the same controls in an SEO settings popup, preserving selection and unsaved values. Template and site-design builders retain two tabs. SEO field paths and API/storage behavior are unchanged.

## Released artifact

- Application commit: `d8d5fac467b84788570bdc66ea8259808cf905f7`.
- Application source tree: `6b8865c4c1cbd3592984ace712ffbbb8b408f626`.
- Acceptance test follow-up: `b03d79e36f9d2b6327a0aea3d102dd42be5ce3ab`; its only difference from the application commit is a browser-test locator correction for the plugin's rendered Auto-generate button. No application code changed after the frozen build.
- Worker SHA-256: `3d82a86045902c6e8512bb38d1e9f080d40ab86a6f048f030cded7593baa1f74`.
- Build ID: `e0egETNBUDmOSfORx0cdw`.
- Worker version: `8eaa6e52-b91e-44e3-a58b-341a56867d46`.
- Deployment: `9bb7b69a-2ece-418b-8523-3765d4a606e0`, 100%, October 26, 2026 at 3:49 PM America/Chicago.

The verified runtime used Node 22.23.2, pnpm 10.28.2 and Wrangler 4.152.0. This repository tracks package distribution files: the six changed generated outputs were committed, and the final Worker was rebuilt from that immutable commit. All 1,429 tracked inputs in both the archive and the actual build directory matched Git, allowing CRLF-to-LF normalization for Windows text archives. The manifest checksums 134 Worker/asset files.

Deployment used the retained artifact with `no_bundle: true` and `keep_vars: true`. Production D1, R2, Queue and secret bindings were checked against the previous version. Cron and disabled live-email settings were preserved. No migration was required: all 59 registered migrations were already applied.

## Verification

- TypeScript passed; lint reported zero errors and 1,077 warnings.
- Design-system/editor tests: 45 files, 239 tests passed.
- Full integration run: 165 files, 682 tests passed in one complete run, without changing timeouts or assertions. These tests used the freshly compiled package outputs subsequently committed unchanged.
- Optimized build, source/artifact verification and production deployment dry-run passed.
- All 31 checkpoint browser scenarios passed against the exact frozen artifact and a fresh isolated fixture. Coverage includes desktop/mobile sidebar order and Inbox count; Post and Page SEO generation, tab switching, expansion, nested image selection, save/reload, publication metadata and mobile layout; and existing Standard Article editing with retirement from new choices.
- After correcting the browser-test locator, TypeScript and lint were rechecked. The full browser run began after that static check completed.
- Production build ID, build manifest and admin JavaScript asset matched retained SHA-256 checksums. Binding readback passed.
- Read-only authenticated production checks verified the new sidebar and empty Inbox count, retained Events/Blank choices, Post/Page SEO tabs and expansion. No test records were saved in production. Read-only CRM, Forms and Tasks/project access checks also passed.
- Ten-minute production observation completed successfully (Oct 26, 2026, 3:49:40 PM CDT to Oct 26, 2026, 4:00:36 PM CDT): 305 Worker events, 120/120 route/access checks, zero exceptions, zero server errors and no unexpected tail exit.

Local evidence and the frozen artifact are retained under `.wrangler/releases/sidebar-seo-20261026/`. This receipt is a documentation-only follow-up; the deployed application commit remains the one recorded above.

## Recovery

Previous Worker: `716640f2-d308-4399-9880-0864dfac963f`.

Pre-deployment D1 Time Travel bookmark: `000000c1-00000171-00005110-f2d91ab4bb550d58e9d2721d811500ae`.

The database schema and template records were not modified. A normal rollback restores the previous Worker with its matching bindings; restoring database data requires a separate reviewed recovery decision.
