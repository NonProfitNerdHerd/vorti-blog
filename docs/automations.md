# Workflows

Open **Workflows** in the backend navigation (`/admin/workflows`). Its submenu contains **Create Workflows**, **My Workflows**, and **Shared Workflows**. Create offers five starter templates and **Build from scratch**. The original `/admin/automations` address remains compatible. Each signed-in backend user can create, test, publish, and pause their own workflows in their selected site. Publishing does not grant access to any destination.

Owners can share a published definition as a template with backend users in the same site. Shared Workflows lists these templates and lets recipients copy them into their own drafts. Sharing never grants editing rights to the original workflow or access to its run history. Copies execute with their new owner's current permissions. Secret keys are masked in shared definitions; review masked values and resource mappings before publishing a copy. Owners can stop sharing at any time; existing private copies remain independent.

## Implemented journey

Choose a trigger, add named action/condition blocks, map trigger or earlier block fields, save a draft, test, and publish. The home lists owner, status, latest result, and search. Detail has owner, published version, draft revision, controls, and test/live run history. Clicking a run shows its immutable definition, individual block states, attempts, timestamps, inputs/outputs, and sanitized failure explanation. Editing or publishing never rewrites old runs. Test mode performs **real writes**, with explicit confirmation; there is no simulation mode.

Triggers:

- Manual input (JSON).
- Form submission creation, or submission workflow status change.
- Board item/task creation, or selected status, assignee, priority, due date, or title changes.
- CRM contact creation or shared profile change, captured from the existing committed audit.
- Page/post creation, title change, or publication status change.

Actions:

- Find a permitted task, page, post, form submission, or CRM contact by ID.
- Create a board item/follow-up task, assign an assignee, or update supported task fields through native Task hooks. Existing task notifications apply to assignments.
- Create a CRM contact through `ContactRepository`, including its existing atomic permission/audit/idempotency handling.
- Create/update pages and posts through native CMS hooks, including existing publishing checks.
- Compare values or test presence, with true/false branches. Unselected blocks are recorded as skipped; blocks after failure remain unexecuted.

Mappings use exact references, for example `{"$ref":"steps.lookup.id"}` or `{"$ref":"trigger.answers.fieldID"}`. Expressions and arbitrary JavaScript are never evaluated. Records are read at execution time, not as historical event-value snapshots. Values used by later blocks are refreshed through current field access before mapping. CRM profiles and structured page/post content currently use JSON configuration. Contact profile updates must use CRM's explicit shared-profile confirmation; a generic update block remains saved but explains this restriction at execution.

## Security and history

All definition/run endpoints scope to the current site and owner. Resource pickers use existing access-filtered APIs. The only privileged read in the action adapter retrieves the stored owner identity. Every resource read/write uses that owner's fresh site authority and native access checks, including retries. Board and CMS mutation hooks retain their existing synchronous validation and commit guards. Unauthorized blocks are retained and fail visibly; they never gain an internal Workspace or Forms bypass.

Historical values are returned only after re-reading all referenced records through current permissions and verifying that every historical field is still present in today's access-filtered shape. Mapped source paths are checked too. A removed/restricted field or changed nested shape withholds all values conservatively. Revoked record access also hides the definition and resource references. Conventional secret keys are masked, and raw SQL/provider errors are never returned. This conservative rule can withhold otherwise harmless values after structural record changes.

## Durability and operation

Apply registered migration `20261026_130000_automations` through the normal release process before running the updated application. It adds standalone platform tables, server-owned origin/site markers to native records, version markers for CMS draft tables, and SQLite source triggers. A clean migration chain is exercised by the native integration suite.

Database triggers insert an event and fan out queued runs **inside the originating mutation transaction**, pinning the version active at that instant. Rolls back with the source write. Events retain references and changed-field names, not copied record data. Each workflow/event pair is unique. Publication retains immutable definition versions. Automation-origin native writes and CRM operation keys suppress automation chaining entirely in this release, preventing self/cross-workflow recursion.

The existing authenticated Worker cron loop calls `/api/automations/tick` with `FORM_JOB_TOKEN`. It uses the existing scheduled Forms infrastructure; preserve that entry point and secret. Each tick claims at most three runs with an atomic D1 claim, persists step checkpoints, and renews execution leases. Queued runs survive process restarts. Safe find operations have at most three attempts and recheck authority. Writes are attempted once. An interrupted running lease becomes a failed run with an explicit possible-write warning; it is never automatically replayed. Inspect destinations before starting a new test after an uncertain write. CRM creates additionally use the native operation key.

Cancellation prevents subsequent blocks and cancels queued runs immediately. It cannot undo completed writes or stop an already in-flight write. Pause stops new event-triggered runs; already queued runs retain their snapshots. History is retained. Home/history currently return at most 100 rows; pagination and retention administration are not implemented.

## Deferred capabilities

Scheduled user triggers, durable delay/wait/resume, approvals/deadlines, webhook or external connector actions, reusable templates/subflows, workflow chaining, automatic recovery of ambiguous writes, arbitrary CRM finance/opportunity/stage actions, custom board-field actions, a dedicated notification composer, richer content progression, and query-based find actions remain future work. No unimplemented block is advertised as available. Complex structured mappings still require JSON. This is a usable first slice, not complete Power Automate parity.

Verification includes SQLite state-machine/mapping/security cases, existing Forms transition regressions, native D1/Payload board access and event/version tests, admin UI checks, TypeScript, lint, and a local production build. No production migration or deployment is performed as part of implementation.
