# VortiCause nonprofit CRM and organization/site foundation

## October 24 implementation continuation — in progress

### Opportunities and volunteers — verified release candidate

Added chapter-scoped opportunity pipelines with the eight seeded stages, configurable/archivable stages, list and pipeline views, exact currency-tagged estimates, qualified staff owners, campaign/target/next-action fields, immutable stage-label history and explicit links to existing gifts or pledges. Staff create pledges through the existing giving screen, then explicitly link the saved record. Stage moves never create commitments, payments or received revenue. Financial links require finance read access in addition to opportunity edit access. Contact views include the same opportunity workflows.

Added volunteer skills/interests/availability discovery, persistent chapter do-not-contact preferences that also honor shared-contact consent, private chapter activities, participation and attendance, recorded outreach/individual responses, and submitted/approved/rejected dated minutes. Private notes reuse existing communications. Discovery, chapter activity, correspondence and hours require their separate categories; discovery does not expose private notes, invitations or hours. Hours require attended participation and retain original submitted minutes; reviewed corrections reject the old entry and record a separate submission. Complete authorized time totals are separate from the paginated rows. Contact views include skills, linked participation, outreach and hours.

Added migrations `20261024_200000_crm_opportunities` and `20261024_210000_crm_volunteers`, and expanded the isolated upgrade/retry verifier to all eight October 24 migration functions. All 91 focused CRM/site regression cases and all five authenticated optimized-Worker browser scenarios passed, including mobile layout, save/reload, explicit financial linking, invitation declines versus persistent preferences, attendance and approved hours. The native fixture upgrade ran twice and retained every original field across 176 pre-existing application tables. TypeScript, focused lint, full snapshot lint with zero errors (1,078 existing warnings), the optimized Linux build and both deployment dry-runs passed. The frozen Worker verifies 961 source inputs; SHA-256: `b2a61601ed208c8f0f58d1786dc2846136eb11a8c0456c0693b44ff13948522c`.

Read-only production preflight identified exactly these two migrations pending, recorded counts for 182 historical application tables, and captured a new recovery point under ignored `.wrangler/releases/crm-phase4-20261024/`. At this checkpoint, neither production migration has been applied and this candidate is not deployed. The later correspondence, import/merge, reporting/export, attachment/timeline, job-handler and CRM-linked Tasks/Boards work remains open.

### Production rollout of households, giving and memberships

Source `8df101bfddbe36fb7b8922b7710638ae8fc36c9f` is pushed on `codex/crm-expansion-20261024` and merged into `main` by fast-forward, bringing the preceding CRM/Sites, SubSites and header releases into `main` as well. The verified artifact is deployed as Worker `65b59880-7c9a-4085-8b5d-ae173a28efdb`, deployment `b63b793f-692a-4998-bb84-fe554badcfc9`, at 2026-10-24T20:45:49.038124Z.

All six October 24 additive CRM migrations completed, bringing the production Payload ledger to 48. Verification confirmed 16 new tables, 20 indexes, 30 triggers and three additive fund columns. All 166 historical application-table counts were unchanged both after migration and after smoke testing. Pre-apply recovery bookmark: `00000c64-00000008-0000510e-d6c5215b691fc94def79c7f2e610a677`. Prior Worker: `1eb5e0db-72fc-485e-a750-c5aa0a67f1fc`. These migrations retain existing IDs and financial history; database recovery remains separate from Worker rollback.

Release validation: 72 focused integration/rendered cases, three authenticated optimized-Worker browser scenarios (including mobile and save/reload), repeated native-fixture upgrades retaining every original field across 160 application tables, TypeScript, full lint with no errors, Linux build, source/artifact checksums and both deployment dry-runs passed. Authenticated production smoke opened and cancelled household, campaign, pledge, recurring and membership/type editors. Public main/child pages and anonymous-denial checks passed. No fictional production accounts, donor records, gifts, commitments, memberships or correspondence were created or sent. Operational receipts and the frozen artifact are retained under ignored `.wrangler/releases/crm-expansion-20261024/`.

The full implementation objective remains active. Next are opportunities and volunteers, followed by correspondence, reviewed imports/merges, reporting/exports and CRM-linked Tasks/Boards, together with the unfinished attachment/timeline and job-handler integration work.

### Release preparation for households, giving and memberships

Continued on `codex/crm-expansion-20261024`, based on the already deployed header-switcher branch. Remote `main` is an ancestor; the prior CRM/Sites, SubSites and header releases are already in this branch's history. Concurrent installation-settings changes and `src/system-management/` remain outside this candidate.

The release checks passed 72 focused integration/rendered cases across the expansion and existing contacts, finance, money, organization policy and header-site behavior. The six real migration functions ran twice against an isolated native D1 fixture and retained every pre-existing field across 160 application tables. Cloudflare internal metadata is excluded from the application-data comparison. The optimized Linux Worker build, TypeScript and focused lint checks passed. All three authenticated Chrome scenarios passed against the optimized Worker: households/relationships/communications/campaigns, pledge payments with save/reload and membership enrollment/renewal, and recurring pause/resume without creating gifts. Browser acceptance found and prompted a fix for inherited table minimum widths overflowing the new screens on mobile; the corrected candidate passed mobile checks. Linux and portable deployment dry-runs passed.

Read-only production preflight identified exactly the six October 24 CRM migrations pending, recorded counts for 166 historical application tables, and captured a recovery bookmark under ignored `.wrangler/releases/crm-expansion-20261024/production-before.json`. No production migration or deployment has been applied at this checkpoint. The rebuilt artifact verifies 944 source inputs; generated import-map/Forms differences are limited to reviewed line endings. Worker SHA-256: `8ae7c8b51823f1ea346d8a3e98d07a2b96646ba3a102a65bf9ac87e75e072a70`.

Full snapshot lint completed with zero errors and 1,078 existing warnings; focused CRM lint is clean. The frozen candidate passed all three Worker browser scenarios after the mobile fix.

This release candidate advances the existing plan; it does not complete the later opportunity, volunteer, correspondence, reviewed import/merge, reporting/export, private attachment/timeline, job-handler or CRM-linked Tasks/Boards work.

### Pledges, recurring giving and memberships — subsequent local implementation

- Added `/api/crm/giving` with chapter-scoped pledges, editable-at-creation installment schedules, recurring expectations, explicit reconciliation dates, audited name/pause/resume/cancellation changes, and immutable original terms. Recurring periods are calculated from their original calendar anchor and paged; no charges or received gifts are generated. Historical pause windows remain recorded.
- Added explicit partial gift applications and reversals, serialized using both commitment and gift revisions. Applications across different pledges cannot over-allocate current cash. Refunds consume unallocated cash first, then reduce application credits proportionally using deterministic integer remainder allocation; voids remove effective credit. No new revenue is created by an application.
- Added `/api/crm/memberships` with configurable individual/household types, term/dues snapshots, enrollment, dated cancellation, renewal lineage, current/expiring/expired/upcoming filters and covered-member history. Household coverage is captured at the term start with a household revision guard. Changed type prices and household membership affect new terms, not prior snapshots.
- Paid enrollment atomically creates a linked dues pledge and one installment; payments use the existing giving workflow and gift ledger. Free enrollment requires no finance edit grant. Membership access does not expose financial payment details; paid enrollment requires finance edit. Membership cancellation intentionally does not forgive outstanding dues: a finance editor reviews that expectation separately.
- Added staff screens in CRM navigation and contact tabs for both giving and memberships, plus focused dues management. Added migrations `20261024_180000_crm_commitments` and `20261024_190000_crm_memberships`. No production migration or deployment has occurred.

Verification checkpoint: the combined six-file run passed 20 tests: five pledge/recurring repository cases, five membership cases (including independent finance restrictions), three rendered React workflows against real SQLite-backed services, two actual D1 payment/refund and membership/dues rollback cases, the six-migration upgrade/retry case, and four endpoint authentication/boundary cases. A subsequent 14-test focused rerun passed after tightening membership-type history and explicitly verifying that a void removes payment credit. TypeScript and focused ESLint passed. The rendered tests are jsdom checks with an in-process service transport, not browser or production Worker acceptance. Existing source changes from the concurrent site-switcher work remain preserved.

The complete approved plan remains open. Remaining work includes private attachments/unified timelines, live browser/optimized Worker verification, opportunities/volunteers, correspondence/PDF/email, reviewed imports/merges, reports/exports and domain job handlers/scheduling, and CRM-linked Tasks/Boards. No complete release or full phase completion is claimed here.

### Earlier local foundation checkpoint

The user approved completion of all remaining CRM phases, including commit/push, additive production migrations and deployment after verification. Recurring giving tracks schedules/payments without charging donors. Correspondence includes PDFs and provider-ready email delivery; live sending remains disabled without configuration. This continuation does not narrow the approved scope.

Current local work adds chapter-owned households, dated member history, primary contacts, reciprocal configurable relationships, exact household giving summaries, campaign/fund/appeal editors, atomic gift attribution, split-fund gift entry, and recorded notes/communications. The leased CRM job engine has passed atomic checkpoint and cancellation tests; domain handlers and scheduled registration remain to be connected. Existing in-progress header/site-switcher work is being preserved.

Verification so far: all nine expanded household/fundraising/communication/job scenarios passed twice against actual local D1 after resolving one runtime timeout; all seven existing financial scenarios also passed. The four real additive migration functions passed isolated SQLite upgrade/retry checks with historical counts and sample values retained. Current TypeScript and focused ESLint passed. Browser verification did not complete: the original seed helper needed replacement for current account guards, bundled Playwright Chromium was absent, and subsequent installed-Chrome runs stalled with local Miniflare/workerd SQLite locks. Full Worker build, representative native historical upgrade checks, and production verification remain pending.

Local verification entrypoints: `node node_modules/vitest/vitest.mjs run --config vitest.config.mts tests/int/crm-households.int.spec.ts tests/int/crm-expansion-upgrade.int.spec.ts`; `node node_modules/@playwright/test/cli.js test --config playwright.crm.config.ts`. The browser fixture is restricted to the operating system's temporary directory, `vorticause-crm-expansion-browser`, and fictional accounts. Browser runs exercised household creation/member/primary-contact actions but stalled around reload. SQLite locking also reproduced outside OneDrive, including at the configuration-time schema probe in `src/payload.config.ts`; OneDrive alone is not an established cause. The stalled runners were stopped. The browser test now explicitly waits for the primary-contact save before reload. Resolve the local proxy/runtime problem or use the optimized single-Worker preview before claiming browser acceptance. The Payload import map was regenerated for the existing site-switcher registration. New migration registrations are `20261024_140000_crm_households`, `20261024_150000_crm_fundraising`, `20261024_160000_crm_activities`, and `20261024_170000_crm_jobs`.

At that foundation checkpoint, pledges/recurring reconciliation and memberships were also unimplemented; their subsequent local implementation is recorded above. Private attachments and unified timelines, connected domain job handlers/scheduling, opportunities, volunteers, correspondence/PDF/email, reviewed imports/merges, reports/exports, CRM-linked Tasks/Boards, and final release verification remain open. New local migrations have not been applied to production; nothing from this continuation has been deployed.

Status: approved for implementation, including production migrations, commit, push and deployment by the user's October 20 amendment. Build and verify reviewable phases; retain the full scope below until complete.

## Baseline and evidence

- Target: `main`, `3e98a7cb8a09b8024fbbe6ee07676889a9c10f4f`; repository remains `vorti-blog`.
- Reference: `NonProfitNerdHerd/NonProfitCRM`, `adc824c00c3fedf06003743de757832ad91a411e`; inspected source and SQL, not just README. Local reference checkout is ignored under `.wrangler/reference-nonprofit-crm`.
- Preserve existing untracked AGENTS.md, CLAUDE.md, and src/system-management work.
- Existing architecture: native Payload authentication/collections, Next App Router, D1, public R2 and protected workspace R2; Forms plugin/outbox; Projects/Boards/Tasks, sharing, notifications, files and time services; content/templates/menus/settings.
- Read installed Next route and multitenancy guides. Use supported extension points; no dependency/core modifications, Supabase, Vercel services, replacement authentication, duplicate Forms builder, or duplicate Tasks application.

## Reference feature inventory

These are source-verified implementation observations, not claims of successful runtime validation of the old application.

| Area | Actual reference implementation | Adaptation |
|---|---|---|
| Organization/auth | Flat organizations, memberships, role/permission tables, Supabase RLS, profile default organization and first-membership fallback (`lib/data/org.ts`, SQL migrations) | Retain visible context and capability concepts; replace auth/storage and implement hierarchical authority |
| Dashboard | Contacts/donations counts and revenue cards; revenue reads at most 1,000 amounts and combines using JavaScript Number | Retain compact cards; replace with authorized, complete, currency-separated aggregates |
| Contacts | Create form/API, list from safe view limited to 200, person details/status/tags, classified notes | Adapt compact forms, tables and profile layout; add organization constituents, full editing, paging, households, chapter relations and all connected tabs |
| Relationships | Household and contact-relationship SQL tables | Build staff management workflows; table existence is not a complete interface |
| Donations | Staff list/detail and portal readers; donation SQL includes amount/currency/source/receipt fields | Adapt history display; build entry, allocation, correction, pledge, recurring and correspondence workflows |
| Memberships | Types and records in SQL; staff list/detail and portal readers | Adapt status/renewal presentation; build create/edit/renewal workflows |
| Tasks/communications | Simple separate task model and readers, note/communication/notification tables | Do not port separate task system; extend VortiCause relationships, timeline and Inbox |
| Imports | CSV contacts/donations only; fixed UI mappings; synchronous row writes immediately after upload; external-ID upserts | Retain source/mapping/results concepts; replace executor with review/approval, conflicts, XLSX, resumability and broader domains |
| Reports | Authorized field catalogue, domains, selected fields, saved definitions, basic filters/sort, CSV/Excel generation; run capped at 5,000 | Adapt field-selection UI; implement complete authorized paging/jobs. Export path does not forward report filters/sort: fix by one shared query specification |
| Admin | Users/roles/settings display screens and permission guards | Build usable site/member/policy administration rather than porting read-only screens as management |
| Portal | Profile update and personal donation/membership/communications readers | Inventory retained for later reuse; no new public CRM submission or separate portal authentication in this scope |
| New functionality | No working hierarchy, opportunity boards, volunteer management, receipt/PDF generation or email-provider delivery workflow found in inspected routes/services | Implement as new capabilities within this plan |

## Architecture and policy decisions

### Shared platform boundary

Add `src/organizations/` for roots, sites, memberships, hierarchy, policy resolution, request context, public site resolution and scoped query helpers. Add `src/crm/` with a `crmModule(platform)` plugin following Forms conventions: collections, services/endpoints, UI, private files, jobs and tests. Keep organization authority outside CRM.

Use one organization root per unrelated network, with a root site and arbitrarily nested descendant sites. Tenant organizations are never CRM partner-organization constituents. Model ancestry using indexed closure rows (ancestor, descendant, distance), including self. Validate cycles, root consistency and moves server-side; no fixed UI depth limit. Bound mutation batches and make large subtree operations durable jobs with a transitional state that denies ambiguous access.

Separate installation operator from site roles. Existing administrators become operators only through the deterministic compatibility migration; new national/regional/local administrators are scoped memberships and cannot edit operator flags. Existing designers/editors retain equivalent default-site CMS capabilities. Operator actions remain explicit and audited.

Policy resolution order:

1. Establish trusted user, root and explicit owning/active site; unrelated roots deny by default.
2. Apply operator authority separately; normal site roles never use global administrator shortcuts.
3. Intersect delegated ancestor capability ceilings from root downward. Locked ancestor constraints cannot be loosened below their controller.
4. Apply site membership and configured ancestor view/edit oversight independently by information category and operation.
5. Add only explicitly allowed sharing grants within those ceilings. No implied sibling discovery, export, editing or publication.
6. Apply record/category restrictions and current revocations. Produce an explanation with controlling source, inherited/local grant and editability.

Categories: shared identity; chapter affiliation; finances; memberships; volunteer experience; volunteer hours; notes/communications; restricted activity; reports/exports. Operations include policy administration, read, edit, export and public placement. Sharing specifies receivers, categories, read/edit, descendant coverage and revision. Policy changes invalidate approvals and access caches; jobs/downloads reauthorize at execution.

The active-site selector is a per-user preference, not authority. Editors, jobs and imports carry an immutable explicit site plus record/policy revisions; switching tabs cannot retarget a save. Reject conflicts with preserved input and reload/review guidance.

### Persistence, auditing and jobs

Native APIs retain access predicates and server validation. Local API calls explicitly use current user/request and `overrideAccess:false` except narrowly reviewed internal services. Audit all existing administrator shortcuts, public/user lookup routes, globals, team visibility, relationship population and privileged queries.

Do not assume multiple Payload calls are atomic. Installed D1 adapter selects default transaction behavior unless transaction options are supplied. Prove behavior with rollback/failure tests before relying on it. Use a focused repository layer with parameterized D1 batch operations for critical mutation + audit + event writes, compare-and-swap revisions and unique operation keys. A rejected conditional update must abort the entire unit, not leave an orphan audit/event. Exercise actual rollback behavior on local D1.

Cloudflare documents D1 batch rollback, but that does not make arbitrary hooks or separate requests transactional: https://developers.cloudflare.com/d1/worker-api/d1-database/ . Observe current limits with indexed EXISTS/joins rather than huge accessible-ID lists: https://developers.cloudflare.com/d1/platform/limits/ .

Use durable job records with bounded cursors, leases, fencing tokens, retries, progress, cancellation and idempotent row operations. Extend the existing scheduled processor with an independent CRM runner; retain Forms outbox patterns without form-submission coupling. Configure local/test scheduling and secrets. Persist job before scheduling, and recheck actor/site authority on every batch and download. R2 and D1 are not one transaction: stage/finalize private objects and reconcile abandoned artifacts.

### Proposed schema families

Names below are proposed collection/table contracts; finalize generated names with migration review.

| Boundary | Additions |
|---|---|
| Platform | organizations, sites, site-ancestry, site-memberships, site-policies, site-sharing-grants, policy revisions, verified host mappings, site settings, content placements |
| Identity | crm-constituents (person/organization), contact methods/addresses/preferences, households, relationships, site-constituent relationships, roles/tags, source identifiers, correction requests |
| Fundraising | campaigns, funds, appeals, gifts, gift allocations, financial adjustments, pledges/payments, recurring schedules/occurrences, in-kind detail, opportunity pipelines/stages/opportunities |
| Membership/volunteers | membership types/terms/history, skills/interests/activity types, experience/participation, hours, outreach requests/responses and chapter/activity preferences |
| Collaboration | scoped CRM links on existing Tasks/Boards, notes, communication records, authorized timeline events; existing Inbox events extended |
| Operations | private file metadata, correspondence templates/documents, email provider configuration/outbox/attempts, imports/mappings/rows/decisions, merge plans, saved reports/export runs, jobs and append-only audit |

All scoped records have indexed root/owning-site relationships, revisions and appropriate compound uniqueness. Source identifiers include root/site/domain/platform; external transaction keys enforce replay safety without amount/date matching. Do not embed growing histories in unbounded JSON. Sensitive files use protected R2 keys and authorized delivery, never public Media paths.

Money uses validated integer minor units serialized safely (decimal integer strings/BigInt arithmetic; currency exponent metadata), not floating-point totals. Allocation sums equal gift amount and totals count gifts once. Pledges and recurring schedules are expectations, payments link actual gifts; refunds/voids/adjustments retain immutable history. In-kind descriptions/estimates remain separate from cash and donor tax valuation.

## Reviewable implementation phases

Each phase includes functioning staff screens, tests, migrations where needed, fictional fixtures and a delivery note. No placeholder phase counts as the complete module. All phases below remain in scope.

### 1. Organization/site foundation and compatibility

Dependencies: approval of this plan.

- Implement platform schema, root/site/member administration, active-site selector, delegated role/capability controls and effective-permission explanation UI.
- Create deterministic default root/site; map existing global settings and content ownership without rewriting content versions. Preserve IDs and public root URLs. Keep personal Tasks/starter projects outside nonprofit ownership.
- Introduce explicit operator status; map existing administrator accounts deterministically and audit migration mappings.
- Audit/adapt existing global shortcuts and CMS/Forms/Tasks/team access. Legacy team records retain audience through explicit compatibility grants rather than suddenly becoming visible across newly created roots. New tenant-team scope is explicit; personal private items retain current rules.
- Scope user discovery/notifications, memberships, settings administration and native relationship selectors.

Acceptance: two unrelated roots and National → two Regions → multiple Locals work through native APIs and UI; child/sibling escalation rejected; inherited controllers visible; separate tabs cannot misdirect saves; legacy CMS/Forms/Tasks permissions and content survive migration.

### 2. CRM contacts and connected staff workspace

Dependencies: 1.

- CRM dashboard, paginated search/filter tables, create/edit person and organization profiles; tabs for details, relationships, giving, memberships, volunteer, opportunities, notes/communications, Tasks and permitted audit.
- Implement shared identity plus separate site relationships, households, tags/roles, addresses/contact methods, preferences and source IDs.
- Shared-profile edit confirmation describes authorized impact without leaking hidden affiliations; correction requests for users without edit permission. No automatic email merges.
- Manual notes/communication entry and durable audited mutations; central append-only audit denies ordinary create/update/delete including client operator APIs.

Acceptance: one person linked to two chapters has one profile but separately protected gifts/hours/notes; shared email and absent email supported; unauthorized counts/affiliations absent from profiles, pickers and search.

### 3. Gifts, fundraising records and memberships

Dependencies: 2 and critical-write rollback proof.

- Working gift entry/detail/correction forms for cash/check/external online/imported and in-kind gifts; campaign/fund/appeal management; split allocation editor; pledges/payment application; recurring expected-vs-received tracking.
- Membership type, term, renewal and history workflows with chapter ownership.
- Currency-separated totals and financial correction reasons/history; no normal destructive gift deletion.

Acceptance: repeated legitimate gifts remain distinct; allocation/refund/void and pledge examples reconcile exactly; recurring expectations/in-kind never inflate cash totals; unrelated chapter cannot read financial records through a shared contact.

### 4. Opportunities, volunteer workflows and existing collaboration

Dependencies: 2–3 and organization-aware workspace authorization.

- Configurable opportunity stages with Prospect → Contacted → Meeting → Asked → Committed → Received and lost/declined outcomes, expected amount/currency, staff, dates and campaign links.
- Extend existing Board view/data-adapter support for opportunity cards; preserve ordinary Task status. Explicit pledge action at commitment; card movement never creates received revenue.
- Reuse Tasks for follow-ups from every CRM domain and completion timeline links. Sensitive CRM-associated task material requires intersected CRM authorization across titles/comments/files/search/formulas/exports/notifications. Broader board placement requires safe audience review or is denied; board membership alone never grants donor access.
- Volunteer skills/interests, activity/participation, site-owned hours, authorized cross-chapter discovery, invitations/responses/history and persistent outreach restrictions.

Acceptance: woodworking can be discoverable without Chapter A hours/notes; persistent opt-out differs from a one-time decline; forbidden outreach explains only authorized reasons; board-only readers cannot learn restricted donor information or private personal work.

### 5. Private correspondence, PDF and email delivery

Dependencies: 3, private-file authorization and durable jobs.

- Correspondence template type reusing appropriate editor/merge controls, preview, printable HTML, Worker-compatible PDF output, generation history and private R2 retrieval.
- Receipts, thank-you letters, annual statements with explicit issuer, currency, date/year and financial scope; issuing-site branding/address/receipt settings.
- Provider configuration/status, sender identity, Worker-secret references, explicit send authorization, CRM-specific leased outbox, attempts and replay controls. Adapter accepts provider idempotency keys; uncertain outcomes require reconciliation rather than blindly resending.
- Select and verify maintained Workers-compatible PDF and spreadsheet libraries locally; do not assume Node native/browser rendering support. Use fictional delivery adapter only in tests; no real emails.

Acceptance: preview/print/PDF work while email says Email not configured; no false sent state; statements reconcile adjustments/pledges/recurring/in-kind correctly; revoked file access fails; repeated send requests do not duplicate confirmed delivery.

### 6. Review-first imports and controlled merges

Dependencies: 2–5 domain services and durable jobs.

- CSV/XLSX upload → explicit site/domain → mapping with samples → validate → suggested matches/conflicts → decisions → approval → resumable application → results/history/downloadable errors.
- Contacts, households/relationships, donations, memberships and volunteer mappings; reusable mapping templates and scoped external IDs.
- Empty cells preserve existing values unless explicitly cleared; permission-safe match reasons; record revision conflicts require renewed review.
- Merge preview/confirmation preserves all linked financial/membership/task/activity/source/history records; never across roots. Keep lineage/aliases and restart-safe relinking for large merges.

Acceptance: zero writes before approval; restart/retry cannot duplicate rows; concurrent edits rejected; repeated gifts without matching source keys remain separate; interrupted merge cannot orphan or expose records.

### 7. Authorized reports and exports

Dependencies: 3–6 and shared scoped query engine.

- Saved report builder: permitted fields, typed filters, sort, preview and CSV/XLSX export using identical query specification and explicit scope.
- Starting reports: giving by date/campaign/fund/appeal/chapter; donor history/retention; outstanding pledges; recurring expected/received; membership renewals; volunteer skills/eligible outreach/hours; opportunities/follow-ups.
- Complete cursor-based exports, progress/completion, private R2 retention and download authorization; spreadsheet formula-injection prevention.

Acceptance: exports beyond a result page match preview predicates and full authorized totals; no silent 5,000-row cap; permission revocation halts/restricts jobs and files; hidden inputs cannot leak aggregates.

### 8. Site-aware public websites and content sharing

Dependencies: 1 and existing content/template/menu routing audit; can proceed after 1 independently of fundraising UI.

- Site-specific settings records reuse field definitions, not duplicated globals; root global compatibility adapters preserve current consumers.
- Default root keeps current URLs. Additional sites use `/sites/{immutable-site-key}/...`; verified exact host mappings may serve the same scoped routes without DNS provisioning. Reject unknown/unverified mappings and host collisions; never trust arbitrary forwarded hosts.
- Scoped slug uniqueness and routing for Posts/Pages and existing Post event data; extend menus, views, templates, media, previews, search, feeds, metadata and caches. Do not create a separate Events model.
- Source sharing makes content eligible; receiving administrators explicitly place source references. Publication, editing and placement are separate rights. Source updates flow through references; unpublish/revocation removes output and invalidates source/receiving caches. Canonical points to source route; no uncontrolled copies.
- Public resolution has no CRM capability. Cache keys include site, route and relevant revision; never cache private CRM output in public caches.

Acceptance: identical slugs on two sites resolve correctly; root URLs preserved; unknown host rejected; private content never enters menus/search/feed/preview; sharing without placement is invisible; source revocation removes receiving output.

### 9. Complete validation, documentation and local delivery

Dependencies: all earlier phases.

- Document future server contracts for contact upsert, volunteer interest, membership inquiries and follow-up Tasks: explicit trusted site, capability check, source/idempotency key, validated payload, result/error envelope. No public submission integration or payments now.
- Seed fictional organizations/users/contacts/gifts/hours/boards for local review; safe fixture cleanup command restricted to fixture identifiers and isolated persistence path.
- Run role matrix through REST, GraphQL where enabled, Local API, custom handlers, direct repository queries, populated relationships, count/search/report/file/job/public routes.
- Test policy changes during jobs, denied child overrides, private-board exceptions, stale context, finance arithmetic, correspondence, unconfigured/retried email, import resume, merges, scoped routing and cache invalidation.
- Test keyboard/mobile/light/dark, loading/empty/errors, unsaved changes and bounded queries; root/package typechecks, lint, generated types/imports, affected design build, integration/browser tests, production build using local/test bindings and Worker dry run.
- Apply additive migrations only to isolated local databases containing representative legacy content; compare historical data/relationships, exercise repeat-safe backfills and upgrade from each phase. No reset/destructive replacement.
- Commit and push reviewable implementation phases; report commit/checks and unfinished scope. The October 20 approval authorizes production migration and deployment. Before release, record the current Worker version and D1 recovery point, review migrations, finish cross-system access enforcement, verify the build and local upgrade, then deploy and verify using separate permission levels. Do not expose tenant creation before isolation is enforced throughout existing systems.

Acceptance: complete staff workflows operate together in a local review installation; all requested categories have UI/API/security tests and delivery evidence; no feature is declared complete from collections or placeholder screens alone.

## Migration strategy and existing-system impacts

Separate tracked additive migrations by schema family and compatibility backfill. Introduce nullable ownership fields before deterministic backfill and enforcement. Where global slug indexes must become scoped compound indexes, preserve every slug/ID and verify uniqueness before replacing the old constraint; never rebuild/reset content wholesale. Account for drafts, versions, relationships and generated search records without rewriting historical document bodies.

Existing records use stable default organization/site identifiers. Existing Forms `site='default'` maps explicitly to the default platform site while retaining old references. Brand/settings/menu assignments remain root-compatible. Personal projects/tasks/files remain outside organizational ownership; no nonprofit-admin override by association. Existing protected storage stays protected; public media is not a private CRM file store.

Schema snapshots, generated types/import maps, indexes and application versions travel together. Test actual D1 constraints and migration preservation against representative existing content before each phase is accepted. Large backfills use resumable markers; partially migrated authorization fails closed.

## Progress and handoff

- [x] Read the full request and inspect current branch and reference code.
- [x] Record actual reference features, reuse boundaries, risks and complete phased scope.
- [x] User approval of this plan, including production release authorization.
- [ ] Phase 1: organization/site foundation and compatibility.
- [ ] Phase 2: connected CRM contacts.
- [ ] Phase 3: fundraising and memberships.
- [ ] Phase 4: opportunities, volunteers and collaboration.
- [ ] Phase 5: correspondence/PDF/email framework.
- [ ] Phase 6: imports and merges.
- [ ] Phase 7: reports and exports.
- [ ] Phase 8: site websites and content sharing.
- [ ] Phase 9: full validation and local delivery.

### Foundation implementation checkpoint — October 20

Implemented (not yet wired into production runtime):

- `src/organizations/policy.ts`: pure, fail-closed category/operation authority evaluator, ancestor ceilings, explicit sharing, hierarchy validation and archive rules.
- `src/organizations/schema-v1.ts`: frozen additive organization/site/membership/policy/grant/context/host tables, ancestry, operation receipts, revision guards and database-enforced append-only audit. Includes deterministic default-root compatibility seed; no personal task ownership changes. Tracked migration `20261020_213000_organization_foundation` is registered, with an unchanged native-table Drizzle snapshot because these explicitly managed platform tables are outside the native collection schema.
- `src/organizations/atomic.ts`: one-batch optimistic write/audit/receipt unit with actor/fingerprint-bound retries and rollback guard.
- `src/organizations/repository.ts`: server-actor-bound organization/site creation, policy updates and membership changes; authority revision fencing and last-administrator protection.
- `src/crm/money.ts`: exact minor-unit parsing/aggregation, currency separation, balanced gift allocations and audited-adjustment ledger arithmetic excluding void/in-kind gifts from received cash.

Validation:

- 26 tests across `organization-policy.int.spec.ts`, `organization-storage.int.spec.ts`, `organization-d1.int.spec.ts` and `crm-money.int.spec.ts` cover the implemented foundation.
- Storage tests use real SQLite constraints/batches through a D1-shaped adapter. Additional actual local workerd/D1 tests passed for rollback, audit tampering, concurrent duplicate creation, and operator revocation between authorization and commit. Remote bindings are disabled; persistence is ephemeral.
- Joined, keyset-paginated authority loading handles a 120-level hierarchy in at most 10 queries, avoiding per-ancestor calls and large accessible-ID filters. Membership, policy, grant, archive/hierarchy and operator changes advance authority revisions at the database boundary.
- Standard application TypeScript passed (`pnpm exec tsc --noEmit --pretty false`) after route type generation and removal of two obsolete generated type files for a deleted route. Changed-file ESLint passed. No design-package code changed.
- No production schema applied and no CRM screens exposed. This is an in-progress foundation checkpoint, not completion of Phase 1 or the module.

Exact next steps:

1. Extend actual local D1 coverage to shared grant receivers, policy changes, deep/wide hierarchies and migration application through Payload's tracked runner.
2. Add site/member/authority management and validated sharing/move services with context-bound edit APIs; audit every mutation.
3. Add compatibility content ownership fields/backfills, generated types and representative legacy migration tests; the initial platform-table migration is already registered but not applied to production.
4. Complete organization-aware enforcement in existing Users/CMS/Forms/Tasks/global/search/file/notification APIs before enabling new tenant creation.
5. Build site administration, effective-policy explanation and active-site selector; finish Phase 1 browser tests.
6. Continue Phases 2–9; maintain full scope and production release gates above.

### Connected contacts checkpoint — October 20

This checkpoint is implemented and locally verified, not a completion of the full CRM plan. Production remains on the previous release; no production migrations or writes were performed.

- [x] Add separate network identity and chapter relationship storage (`contact-schema-v1.ts`), with cross-root/immutable-ownership constraints, source identifiers and correction requests.
- [x] Add validated Person/Organization profiles, multiple email/phone methods, addresses, communication preferences, chapter roles and tags.
- [x] Add authenticated, bounded, non-cacheable CRM endpoints; derive actors from the authenticated user and reject foreign-origin mutations. Unsupported actions cannot change authority.
- [x] Add site-scoped contact lists, role/search filters, complete matching counts and keyset pagination. Shared household email never automatically merges records.
- [x] Add confirmed shared-profile edits with revision checks, retries and atomic audit records. Chapter role/tag updates have independent revisions and never rewrite shared identity or another chapter's relationship.
- [x] Add correction submission, authorized paginated review, reasoned resolve/decline actions, immutable original requests and audit history. Readers cannot resolve requests.
- [x] Add a responsive centered contact editor and CRM navigation link; preserve failed input and warn about unsaved changes. Current context is deliberately pinned to the compatibility site until cross-system tenant isolation is complete.
- [x] Register `20261020_222000_crm_contacts` and its snapshot; regenerate the admin import map and native types (native collection types remain unchanged).
- [x] Prevent automatic development schema pushing once explicitly managed organization tables exist; use migrations instead of risking removal of private runtime tables.

Local interface: `/admin/crm`, after native schema setup and the two registered CRM/organization migrations. `tests/helpers/seedCRM.cli.ts` supplies fictional review accounts only when an explicit isolated `.wrangler` test path is set. `tests/helpers/migrateCRM.cli.ts` verifies native migration tracking, repeat safety and existing-table hashes; it rejects production intent flags.

Validation evidence:

- Organization/money/contact/HTTP regression coverage: 37 tests across six files, including rejection when membership is revoked between authorization and contact delivery. Correction review assertions extend the existing contact permission test.
- Browser coverage: three passing serial scenarios for creation/reload, profile confirmation, separate chapter details, reader correction submission, authorized correction review, narrow-screen overflow, and clearing cached contact details after permission denial.
- Application TypeScript and changed-file ESLint pass. Payload imports/types regenerated. No shared design-package source changed.
- OpenNext optimized application/Worker builds and Wrangler deployment dry-run passed with local-only bindings. Final source validation includes permission-revocation guards; these artifacts are not a production deployment.
- Native tracked migration verification preserved hashes across 131 pre-existing local application tables, including fictional Posts/Pages and their versions, and a second run was safe. First-time tracked migration creation also passed on a separate isolated database with the same preservation/retry checks.

Still unfinished (do not mark the whole module or Phase 2 complete): household/relationship management, authorized chapter linking and sharing approvals, site administration/context selection, full legacy API isolation, CRM dashboard/timelines/Tasks integration, fundraising/membership/volunteer workflows, private files and correspondence/email, reviewed imports/merges, reports/exports, and subsite website publishing. No placeholder tabs for those features were added.

Next implementation order:

1. Finish Phase 1 integration using `organization-access-audit.md`: scoped account capabilities, legacy content/Forms/workspace guards and team audiences, effective-policy administration, safe sharing/move services and explicit site context. Add account deactivation/recovery semantics before exposing scoped administrators; new audit foreign keys intentionally retain historical actors.
2. Finish contact households/relationships, chapter-link approval and restricted activity/timeline interfaces, then implement the financial/membership services and staff forms with the existing exact-money core.
3. Continue every remaining phase above, run full migration/permission/browser release checks, record production recovery details, commit/push, apply additive migrations and deploy only after the complete production release gates pass. Production authorization remains approved; no further approval is needed merely to continue implementation.

### Authority restrictions and gift workflow checkpoint — October 20

Implemented in source; the full CRM/tenant plan remains unfinished:

- Add category/operation restrictions per site membership, current-account deactivation checks and retained account status. Scoped administrators cannot bypass finance restrictions through membership management. Last-administrator checks exclude disabled accounts, and deactivation cannot remove the remaining administration path.
- Apply account status checks to registered custom endpoints, native/Local API collection operations, global reads/updates and login. Trusted migration tools use a server-owned Symbol; JSON cannot request that exemption. This is deactivation enforcement, not a claim of complete tenant isolation or complete background-job reauthorization.
- Add chapter-owned funds and gifts with exact string minor units, fixed per-chapter currency precision, date-only receipt dates, references, notes and balanced fund allocations. Cash/check/external-online records and in-kind estimates keep distinct kinds. No online charging or email delivery was introduced.
- Add reasoned refunds, signed corrections and voids. Retain original amounts and allocations, update net amounts/fund balances with revision checks, and store append-only adjustments plus immutable platform audit records in the same D1 batch. Split-fund changes must balance and cannot make any fund negative. In-kind estimates use corrections rather than cash refunds.
- Add a functional Gifts contact tab: fund selection/creation, gift recording, paginated lists, exact amounts, gift details, paginated adjustment history and correction controls. Preserve failed input and warn before discarding it. Recheck access on focus and clear cached financial details after permission denial.
- Register additive authority/finance migrations with native snapshots; native types/imports regenerate without collection-type changes. Bound escaped contact search patterns to D1's LIKE limit, and reject numeric JSON money values rather than accepting lossy conversions.

Verification: 53 focused integration tests passed across eight files (organization policy/storage/workerd, account guards, money, contacts, finance and endpoints), including seven actual local-D1 financial scenarios. Four serial browser scenarios passed with the integrated account guards, including gift/refund persistence and mobile overflow. Root TypeScript and focused lint passed; native types/imports regenerated without native collection changes. The optimized Next/OpenNext Worker build and Wrangler deployment dry-run passed using local-only bindings. Native tracked migrations preserved all 131 existing application tables and were repeat-safe with the final guard configuration. No production migration or deployment has been performed for this checkpoint. Tenant context remains pinned to the compatibility site and organization-creation endpoints remain unexposed.

Remaining release work is unchanged: site/member/context administration, ownership and effective authority throughout legacy CMS/Forms/Tasks/globals/accounts/jobs/files/public routing; household/relationship and chapter-sharing workflows; campaigns/appeals/pledges/recurring expectations/memberships; opportunities/volunteers; private correspondence/PDF/email outbox; reviewed imports/merges; authorized reports/exports; and site-aware publishing. The new gift workflow is only part of Phase 3, not completion of that phase or the plan.

### CMS / Forms / Tasks enforcement checkpoint — October 21

Implemented the next Phase 1 integration slice:

- Site ownership and native access predicates across content, design, menus, taxonomy, media metadata, search, saved views, and import/export records, including drafts, versions, restores, and counts. Existing route slugs remain intact; uniqueness is scoped to the site. SQL guards fence CMS writes against authority changes during a request.
- Scoped native account discovery and operator-only account administration. Added explicit content, Forms, submission, and workspace capability mapping, while preserving default-site designer/editor compatibility and retaining private task ownership.
- Current-capability Forms checks, staff API ownership/version enforcement, explicit-site export and CMS-action reauthorization, and isolation of internal requests from entry-review/redaction requests.
- Site-owned team workspaces and an indexed, trigger-maintained grant projection for native Tasks/Boards/Projects predicates. Preserved private exceptions, personal starters, comments, notifications, time, files, and sharing behavior. Approval fingerprints and atomic sharing guards include site authority revisions. Personal initialization remains durable after native account access is tightened.
- Registered additive ownership migrations and generated native snapshots/types, including new lock-relationship columns. Local upgrade/retry verification preserved 131 historical application tables and verified 51 exact native ownership indexes. Separate-account native and HTTP/GraphQL verification covers foreign IDs, lists/counts, cross-site assignments, form slug collisions, private drafts/versions, and revocation. A bounded concurrent-permission check prevents repeated hierarchy initialization during admin rendering.

See `docs/organization-access-audit.md` for the remaining integration gates. This does not finish Phase 1 or the full CRM plan. No new household, membership, fundraising, opportunity, volunteer, correspondence, import/merge, or reporting workflow is declared complete by this checkpoint. Production migration and deployment remain pending completion of the approved cross-system release gates; organization creation/context switching remain unexposed.

Checkpoint verification: 70 focused integration tests, 40 native workspace cases, the separate-account REST/GraphQL check, and four CRM browser scenarios passed. Final TypeScript, focused lint, Next/OpenNext Worker build, and Wrangler deployment dry-run passed with local-only bindings. The final native authority-witness privacy and concurrent-permission checks also passed. These are local verification results, not a production release.

### Desktop continuation — local administration and commit guards

Implemented the next local Phase 1 slice:

- Added server-owned native mutation proofs for accounts, Forms, and workspace records, plus Forms draft-version guards. Final D1 checks cover current account/site authority and task/board/project audience witnesses. Raw field, dependency, view, placement, and time writes use the same transaction boundary; reviewed sharing retains its existing audience fingerprints. Nested calls fail when their request's authority epoch changes.
- Fenced export completion atomically after current requester authorization, removing private objects when publication fails. Recheck private Forms/export/workspace downloads after R2 retrieval. Preserve the existing stored-source and current-recipient notification checks.
- Added authenticated administration services and `/admin/sites` for isolated local review: organization/child-site creation, member roles/restrictions, inherited policy controls and effective-permission explanations, read/edit sharing, and audited site moves. Membership delegation and child creation cannot bypass category restrictions. Site discovery filters denied records and uses encrypted per-actor cursors; member and sharing lists are paginated.
- Added revision-checked site preferences and explicit editor context. Existing native editors carry their original virtual `editorSite`; CRM editors retain their original site through refreshes and another tab's preference changes. Failed saves preserve input; permission denial clears sensitive contact details. Fixed reopening a contact before the previous save's refresh finished.
- Registered `20261022_010000_native_mutation_guards` with its native snapshot; regenerated Payload types and the admin component map. Local tracked migration verification preserved all 131 historical application tables, verified 51 ownership indexes and 48 native proof columns, and remained repeat-safe.

Review routes are registered only with explicit isolated local persistence bindings. This does not enable production tenant onboarding. Subtree moves are limited to 200 sites and reject larger work pending durable hierarchy jobs. Site-specific public settings/routing and the remaining CRM phases stay unfinished; this checkpoint adds no new household, membership, pledge, opportunity, volunteer, correspondence, import, or reporting workflow.

See `organization-access-audit.md` for the current boundaries. All verification uses fictional accounts/local databases. Production migration and deployment remain deferred until the full approved release gates pass.

Verification checkpoint: the final focused run passed 65 integration tests across nine files, including all 24 organization storage cases with query-inference hardening. Another 29 native workspace compatibility cases and five browser scenarios passed, including contact/gift/refund persistence, private workspace behavior, administration, mobile layout, and separate-tab site context. Tracked migration upgrade/retry checks preserved 131 historical application tables, 51 ownership indexes, and 48 proof columns. Separate-account native API checks and scoped file stage/upload/download/delete checks passed before the final query-inference hardening. Focused ESLint and diff whitespace checks passed.

Earlier TypeScript, optimized Next/OpenNext Worker builds, and deployment dry-runs passed. Final whole-folder verification is not green: newly arriving OneDrive conflict copies introduce duplicate TypeScript declarations (including `cloudflare-env.d-HeartlandChaser.ts` and `.next/types/routes.d-IkesHP.ts`); a native API helper now fails on the design package's missing generated `shellStyleKeys` export; the latest Docker build rerun exited unsuccessfully without a useful diagnostic. Those unrelated shared-folder changes were left intact. Reconcile the conflict copies and generated design package, then repeat TypeScript, native API verification, and the local Worker build/dry-run before advancing the release gates.

### Combined release preparation — October 23

- Reconciled OneDrive conflicts against Git history. The newer site-builder copies matched the committed implementation; restored those canonical versions, rebuilt the package, and retained 260 conflict files and comparison reports under the ignored `.wrangler/release-recovery-20261023/` directory. One unreadable conflict build-cache file remains outside source. Historical committed migrations remain unchanged.
- Added private per-site identity settings (name, tagline, timezone), authenticated revision-checked services, audited saves, and a staff editor that retains failed input. Full public Site Settings and existing URLs remain on the compatibility site; public subsite routing remains unfinished.
- Added commit-time Global guards for Site Settings, Navigation, and System Settings, with privileged-read proof redaction. The anonymous public renderer uses a server-only compatibility-site Navigation context and confirms its authority before delivery; anonymous HTTP requests cannot forge that context.
- Preserved native Payload authentication after permission changes. Native authentication metadata upserts can retain an unchanged historical proof only when all account application fields are unchanged. Profile/role changes and fresh stale proofs remain guarded; protected account columns are derived from the installed schema so future fields fail closed.
- Registered additive scoped-settings, Global-guard, and authentication-compatibility migrations with snapshots. `ORGANIZATION_ADMIN_ENABLED` is an explicit server setting; the release candidate enables Sites administration after migration and verification.

The release is authorized. Production apply/deployment and final smoke-test evidence will be recorded after the remaining verification completes. No new public subsite routing, household, pledge, membership, volunteer, correspondence, import/merge, report, or CRM-linked board workflow is included.

Release validation checkpoint:

- The reconciled design package passed 232 tests and its type check/build. The final focused CRM, organization, Forms export, and workspace projection run passed 74 tests across 10 files, including actual D1 mutation/revocation checks.
- Native API validation passed all 15 Projects and 14 Tasks cases, five menu cases, seven site-template persistence cases, the separate-account API check, and the private-file helper. Additional Forms delivery/security/rendering integration checks passed during preparation.
- Additive migration upgrade/retry checks verified all 10 pending organization/CRM migrations, preserved 131 historical local application tables, and checked 51 ownership indexes and 48 native proof columns. Production preflight recorded 137 existing tables, the expected administrator, migration history, prior Worker version, and a D1 recovery bookmark in the ignored `.wrangler/releases/20261023/production-before.json`.
- TypeScript, lint, the optimized Linux Worker build, and deployment dry-runs passed. Regenerated Forms assets match the Linux build. The portable bundled Worker SHA-256 is `c511032de14d078308a7a7ed6d557674e1c45a44338362abff77b8094acec1fd`; five portable files and 3,367 expanded artifact files were checksum-verified. Deployment uses this prebundled output to preserve Linux-resolved external modules on Windows.
- GitHub Actions and repository webhooks are absent. Cloudflare Builds trigger inspection returned HTTP 403 with the existing OAuth scope; no trigger configuration was changed. Inspect production version/history again after pushing the release branch before any manual apply.

All eight release browser scenarios passed against the optimized Worker: contacts/corrections, gift/refund persistence, menus/public rendering, Sites settings conflicts and separate-tab editing, template preview/publication/Blank creation, and authenticated REST/GraphQL tenant isolation. The browser preview used isolated Wrangler 4.152 with standard CA certificates after diagnosing a Wrangler 4.116 local-proxy disconnect failure. The pinned build/deploy toolchain remains unchanged, and the portable prebundled deployment dry-run passed on Windows.

Production release and authenticated smoke tests remain pending at this checkpoint. A failed move of an old ignored build cache followed Windows dependency junctions; the local dependency installation was restored from the unchanged frozen lockfile, and TypeScript passed again. Source and unrelated work were preserved.

### Production release — October 23, 2026

Deployed source commit `21e1bf4cba75ac24f613d474ea4d1c178e1c6a2a` from `codex/crm-sites-release-20261023` to the existing Cloudflare Worker. Active Worker version: `8d11c6bd-7ad5-4601-ac68-0a56f89202b9`. Production Sites administration is enabled with `ORGANIZATION_ADMIN_ENABLED=true`; existing bindings, secrets, public URLs, and the compatibility site remain in use.

All ten additive migrations completed (Payload ledger batches 25 and 26; 41 total migrations). The native CLI remote proxy disconnected after the first six; the remaining four ran through their unchanged committed migration functions over the authenticated D1 API. Verification found no row-count differences across 137 historical tables and confirmed 51 ownership indexes, 48 native proof columns, six Global guards, and two native authentication guards.

The pre-apply D1 recovery bookmark is `00000b73-00000000-0000510d-c614f56d56a9d50c343cf6a76ee23578`; the prior Worker version is `5ba884b9-4c02-4df9-a9f7-f95cc75b7e38`. Local operational receipts are preserved under ignored `.wrangler/releases/20261023/`, including `production-before.json`, migration receipts, schema verification, and HTTP smoke results. Database recovery must follow the reviewed recovery procedure; the prior Worker predates tenant isolation and must not be restored blindly after new site content or authority changes.

Authenticated production smoke checks passed for session continuity, dashboard counts (22 published posts, 38 published pages, two drafts, four unfinished personal tasks, one project, one board), CRM compatibility-site selection, opening/cancelling the contact editor, Sites membership display, and effective permissions. Public home rendering returned 200; anonymous administration returned 401 and users/private tasks returned 403. Production writes involving contacts, gifts/refunds, exports, permission revocation, and multi-site scenarios were covered by the isolated validation suite rather than fictional production records. New public subsite routing and the remaining CRM phases remain unfinished.

### Integrated SubSites release candidate — October 23, 2026

The candidate moves site administration into Site Settings → SubSites and retains Payload navigation in CRM. `/admin/sites` redirects into the integrated tab. Child websites use stable `/sites/<site-key>` paths, independent presentation settings and copied design dependencies, explicit initialization/publication, and an inherited Enable SubSites ceiling. Disabling an ancestor retains records and authorized maintenance access while pausing descendant public delivery and submissions. It leaves the controlling site's own website available.

The additive `20261023_200000_subsite_websites` migration defaults existing children to unpublished and SubSites disabled. Local upgrade/retry checks preserved 161 historical application tables. All 75 focused integration cases, 238 design-package tests, and ten release browser scenarios passed. Browser coverage includes CRM corrections/gifts/refunds, integrated/mobile navigation, separate-tab editing, independent branding copies, stale saves, inherited pause/re-enable, duplicate page and form slugs, public Forms submission, private XLSX/receipt access, template workflows, and native REST/GraphQL tenant isolation. TypeScript, lint (no errors), the optimized Linux Worker build, and Linux/portable deployment dry-runs passed. Production rollout and the authorized `subtest` launch remain pending at this checkpoint.

The frozen Worker SHA-256 is `5a6ac216023b98c0691cfb1daa76d67fc4411116d52d73bf0d280e2aecdd5371`; its 542 runtime source inputs were checksum-verified, with 129 static asset files. Local diagnostic bundles remain separate and are absent from this artifact. Operational evidence is retained under ignored `.wrangler/releases/subsites-20261023/`. Public Forms URLs stay bound to their URL's website even when a staff member's active editor site differs. Saved drafts, surveys, rich-text links, hero/catalog links, and continuation links carry the child prefix.

Public child routing requires the Worker boundary and the pinned OpenNext adapter's Edge middleware rewrite; direct `next dev` does not provide the trusted child context. Custom domains/subdomains, large hierarchy moves, and the remaining CRM phases remain unfinished.

### Integrated SubSites production receipt — October 23, 2026

Source commit `c54b59c4372c5f9395ebcdbc2486ec32b840769a` was pushed on `codex/subsites-public-websites-20261023` and deployed as Worker `cb4b50ec-77bd-435f-940f-68305c32c5d9` at 23:53 UTC. The deployed artifact matches the verified candidate checksum above. Existing Cloudflare bindings, secrets, authentication, main-site URLs, and enabled administration remain in use. GitHub Actions and repository hooks were empty at release inspection; deployment was manual.

The single additive migration `20261023_200000_subsite_websites` completed in Payload batch 27 (42 total migrations). It added ten nullable copy-identity columns and four website availability guards. All 164 baselined historical tables retained their row counts before launch, with no differences. The pre-apply D1 recovery bookmark is `00000b83-00000000-0000510d-276cb2794e87e179457f1eec11a29071`; the prior Worker is `8d11c6bd-7ad5-4601-ac68-0a56f89202b9`. Database recovery requires the documented recovery procedure. Restoring the prior Worker alone would remove child routing, so review the launched website state before any rollback.

The existing administrator enabled SubSites on the primary site and the authorized `subtest` child was created, initialized, previewed, and published at `https://vorti-blog.ike-j-rebout.workers.dev/sites/subtest`. Its independent template selection and presentation controls are available in the integrated tab; no posts or pages were copied. The child's own Enable SubSites remains off. `/admin/sites?site=default` opened Site Settings → SubSites successfully. Membership and effective-permission displays loaded, CRM retained the standard sidebar, and the contact editor opened/cancelled without creating records. Dashboard counts remained 22 published posts, 38 published pages, two drafts, four unfinished tasks, one project, and one board.

Anonymous production checks passed for main/child homepages and the child posts listing (200), unknown child sites/pages and child admin paths (404), and blocked administration/users/private tasks/private files (401/403). Child responses are private/no-store and links remain child-prefixed. Gift/refund writes, public Forms submissions, exports, revocation, hierarchy pause/re-enable, and separate-tab conflicts were verified in the isolated suite; no fictional production accounts, financial records, forms, or submissions were created. Operational migration, deployment, HTTP, and browser receipts are retained under ignored `.wrangler/releases/subsites-20261023/`. Custom domains/subdomains, large hierarchy moves, later CRM workflows, and CRM-to-board privacy intersections remain unfinished.


### Shared header site switcher candidate — October 24, 2026

Site context is selected in a compact tab beside the avatar throughout the admin, including CRM's custom Payload template. Selecting a site validates current authority, revision-checks the existing preference service, and opens that site's dashboard. Existing Payload/custom before-unload guards drive a cancellable in-page confirmation. Failed switches preserve the original site and input. The separate CRM/SubSites selectors and preference buttons were removed; relationship and destination fields remain.

Explicit admin URLs, same-origin navigation context, and page-bound API headers keep other tabs from retargeting reads or saves. Site-owned dashboard projects/boards are filtered to the selected site while personal work keeps its existing visibility. Installation settings remain installation-wide; installations with administration disabled retain their native dashboard. No migration, authentication replacement, public routing change, or additional authority is introduced.

Validation passed 80 focused integration cases and eleven browser scenarios, including placement across admin areas, native unsaved-edit cancellation, failed-switch recovery, separate tabs, mobile bounds after sidebar transitions, CRM gifts/refunds, SubSites publication, templates/menus, public Forms, native REST/GraphQL isolation, and private XLSX/receipt access. Focused lint, the optimized Linux Worker build with TypeScript, and Linux/portable dry-runs passed. One older native dashboard suite fails to initialize its bootstrap fixture on both this source and the unchanged deployed baseline; the dashboard widgets and actual Worker queries passed the focused and browser coverage instead.

The frozen Worker SHA-256 is `913e21509d9d0fc06ee8ef2d13a4a2711706a95bb8bbd6df4b72feb4fc5d63c2`, with 909 verified source/generated inputs and 129 static files. Four regenerated Forms text assets differ only in line endings. Concurrent CRM expansion and system-management work is preserved outside this release snapshot. Receipts are retained under ignored `.wrangler/releases/header-site-20261024/`. Production deployment and authenticated smoke checks remain pending at this checkpoint.


### Header switcher permission refresh — October 24, 2026

The shared switcher opens the selected dashboard with a full navigation after the existing leave guard and discard confirmation. This refreshes native Payload permissions and editor styles; the already-approved navigation does not ask twice. A new child-only account with no saved context explicitly chooses its first site beside the avatar before workspace content mounts. Explicit unavailable URLs and revoked saved choices still fail without substituting another site.

The follow-up passed 81 focused integration cases, including the new initial-choice case. Browser coverage verifies first choice, single-site labels, permission refresh from editor to reader, native unsaved input, failed requests, independent tabs and mobile placement. The optimized Linux Worker build passed TypeScript; focused lint and Linux/portable dry-runs passed. No migration is required. Frozen Worker SHA-256: `a245fb51566e54a6c811a74c5ad68208f8c84cc7136a16bc2e4b7a52fe894ad2`; 909 verified inputs and 128 static files. Operational receipts remain in ignored `.wrangler/releases/header-site-20261024/followup/`. Authenticated production smoke requires an active user session.


### Header switcher production checkpoint — October 24, 2026

Source commit `436e9672113653875758187382c38410d704ee34` is pushed on `codex/header-site-switcher-20261024` and deployed as Cloudflare Worker `1eb5e0db-72fc-485e-a750-c5aa0a67f1fc` at 2026-10-24T19:26:06.312918Z. The initial header deployment was `44538bea-0337-4871-a411-1f74f13e13fd`; it is the immediate Worker rollback target. The prior SubSites Worker was `cb4b50ec-77bd-435f-940f-68305c32c5d9`. No migrations were applied; the 42-entry production ledger still ends with `20261023_200000_subsite_websites`. Pre-deployment D1 recovery bookmark: `00000c58-00000000-0000510e-8d1ca28a841efaed859033ce8e56a12c`, captured 2026-10-24T19:25:28.549Z. Database recovery remains a separate documented procedure, not an automatic Worker rollback.

Final validation passed 81 focused integration cases and twelve browser scenarios. TypeScript in the optimized Linux build, focused ESLint, and Linux/portable Worker dry-runs passed. Existing native dashboard bootstrap-fixture failure reproduces on the unchanged baseline; focused widgets and real Worker dashboards passed. Production main-site and published `subtest` home/listing returned 200; unknown child sites/pages and child admin routes returned 404. Anonymous organization administration, user discovery, private tasks and private file access were denied. Existing publication state and zero child posts/pages were preserved. Five-minute monitoring observed 4 events, 0 exceptions and 0 error logs; outcomes: {"ok":4}. Receipts and immutable artifact checksums are retained under ignored `.wrangler/releases/header-site-20261024/followup/`.

Authenticated production UI smoke remains pending: the user's admin session expired and the browser is at login. Header placement, site switching, unsaved-input retention, permission refresh, single-site accounts, CRM/SubSites integration and independent tabs passed in the isolated browser suite; they have not yet been rechecked in this deployed authenticated session. No production fictional accounts or content were created. Concurrent CRM expansion and system-management work remains outside this release.
