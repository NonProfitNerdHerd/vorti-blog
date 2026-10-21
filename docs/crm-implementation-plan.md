# VortiCause nonprofit CRM and organization/site foundation

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
