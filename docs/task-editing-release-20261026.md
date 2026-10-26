# Task editing and scheduling production release — 2026-10-26

Production: https://vorti-blog.ike-j-rebout.workers.dev/admin/collections/review-tasks?site=default

Existing task dialogs now edit the title and description directly and save fields automatically. Details, Subtasks, Comments, Attachments, Dependencies and conditional Tracked Time use connected tabs beneath the description. Collaboration opens in a nested popup. Discrete edits save immediately; text waits 600 ms or blur. Serialized revision-aware writes retain failed drafts and require explicit resolution of concurrent changes. New popup drafts retain Create task, and comments retain Post comment.

Rapid inline entry clears and retains focus while creation runs. The shared optimistic queue preserves temporary task identities, waits for confirmed parents before creating children and retries using stable request keys. Server-side keys are scoped to the authenticated user and site, with input signatures preventing conflicting reuse. Creation uses existing access checks and hooks.

Timeline task labels and bars share rows. Bars support pointer movement/resizing and keyboard alternatives, dependency connectors and conflict indicators; successors are not automatically rescheduled. The default range is 28 days, with all requested ranges through 365 available. Calendar adds Due date, All Open Tasks and Created date modes, inclusive date spans, separate undated tasks and distinct bubbles.

## Released artifact

- Published application commit: `a3bb6de`.
- Application source tree: `88417ac8e33b242e61a0e712ebcd10a0f156776b`.
- Frozen build commit: `a2eb7732d475e1f3670f17ad105583c81f2504a8`. GitHub's email privacy protection rejected the original push. Only the unpublished release commit identities were replaced with the account's no-reply identity; the published application commit has exactly the same source tree.
- Acceptance-test follow-up: `1bb8166212831eb215ab5d740d2516b484243b4e`. Its only change is replacing the CRM test's removed Save task action with Saved and persisted-status assertions.
- Worker SHA-256: `7b8809f7359174cb4c7c8eea55e797664f8b3a8b1489f4618b8773e7e939f878`.
- Build ID: `HRTKKYlE50KyWPUENHNc3`.
- Worker version: `d5f3e833-a8fe-4b7b-86e8-136d6aa2c9e4`.
- Deployment: `7037af94-d070-491b-9768-3a2556545911`, 100%, October 26, 2026 at 23:09:35 UTC.

Node 22.23.2, pnpm 10.28.2 and Wrangler 4.152.0 built the artifact in an isolated Linux workspace. All 1,441 tracked build inputs matched the immutable archive and Git, allowing CRLF/LF normalization. The manifest checksums 134 Worker and asset files. The exact frozen artifact was browser-tested, uploaded without rebuilding using `no_bundle: true`, and deployed through the repository's production-intent guard. D1, R2, queue and secret bindings, cron and disabled live-email configuration were preserved.

## Migration

The production guard applied only `20261026_220000_task_creation_keys`. It adds nullable task creation keys/signatures and a unique index, plus a dependency table for standalone boards. Existing project dependency records and existing tasks are preserved. The production ledger advanced from 59 to 60 migrations, with no foreign-key violations. Optimization completed after migration.

## Verification

- TypeScript and lint passed with zero errors. Existing lint warnings remain.
- Design-system/editor tests: 45 files, 239 tests passed. Compiled shared-package outputs and generated Payload types are committed.
- All integration projects ran sequentially: the full run passed 691 of 692 tests. The failing new idempotency test exposed an invalid lookup through a private field; the corrected implementation passed the entire 28-test native project. The final 11 model tests and one additional native response/privacy test passed. Combined coverage is 167 files and 696 distinct passing tests; this was not one uninterrupted green invocation.
- All 33 release browser scenarios were verified against the same frozen artifact. The complete run passed 32; its remaining CRM test waited for the intentionally removed Save task button. After changing only that test, the corrected scenario passed, including an authenticated API assertion that completion persisted. The original failure evidence is retained.
- Task browser coverage includes delayed rapid mixed entry, retry after failed saves, tab changes, close flushing, preserved child entry, nested popup focus, mobile layout, keyboard and pointer scheduling, row alignment, dependencies, combined time history and calendar modes.
- Under a deliberate 700 ms creation delay, all eight measured inline entries cleared before the next frame; the slowest measured feedback was 43.2 ms. Isolated-server request handling measured 11 creates at median 1,993 ms / p95 3,494 ms and nine updates at median 1,738 ms / p95 2,283 ms. These local measurements include test-runtime contention and are not production network latency claims.
- Production binding readback and three exact build/admin-asset checksum comparisons passed.
- Read-only signed-in checks verified the editable task header, Details field order, all six tabs, dependencies and combined time UI. Escape closed the nested collaboration popup and restored focus. No production tasks, comments, dates or time entries were edited during verification.
- Ten-minute production observation passed, from 23:09:48 to 23:20:39 UTC on October 26, 2026: 492 Worker events, 120/120 route/access checks, zero exceptions, zero server errors and no unexpected tail exit.

The artifact, manifest, build/static/integration logs, browser records, deployment metadata and migration evidence are retained locally under `.wrangler/releases/task-editing-20261026/final-v3/`. Original unrelated working-tree edits were preserved. This receipt is a documentation-only follow-up.

## Recovery

Previous Worker: `8eaa6e52-b91e-44e3-a58b-341a56867d46`.

Pre-migration D1 Time Travel bookmark: `000000c5-00000006-00005110-5fee0e2df4a8d404490cbdfea4ed4b6d`.

A normal Worker rollback can retain the additive schema and task history. The migration's down action deliberately refuses to discard creation retry identities. Database restoration requires a separate reviewed recovery decision because it would also affect data written after the bookmark.
