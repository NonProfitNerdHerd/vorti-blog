# Organization rollout: existing-system access audit

This is the implementation checklist for Phase 1. It is not a claim that current VortiCause is already an isolated multi-organization installation. Tenant onboarding remains unexposed until the integration below is complete.

## Initial source findings (see subsequent implementation checkpoints)

| Boundary | Existing behavior to adapt | Integration requirement |
|---|---|---|
| `src/access/content.ts`, Posts/Pages | Authenticated accounts can read drafts and mutate content without a site filter | Explicit owning site, scoped read/edit/publish, root-compatible public resolution; preserve draft/version behavior |
| `src/access/design.ts`, SiteTemplates, design package collection access | Administrator/designer role is installation-wide | Distinguish operator from scoped design capabilities; scope shared library metadata and template selectors |
| `src/collections/Users.ts` | Administrator manages all accounts; first-account bootstrap counts globally | Only operators manage installation accounts; site administrators manage scoped memberships without global account privilege; redact cross-root discovery |
| SiteSettings/SystemSettings/Navigation globals | One installation-wide settings set, public site settings read | Preserve root canonical values; site settings records and context-aware services; operator-only platform configuration |
| `src/forms/access.ts` | Role defaults grant string site `default`, plus user-provided formAccess | Map to default platform site; intersect delegated capabilities; server-only site assignment and integration reauthorization |
| Forms plugin/runtime/surveys/exports/entry workflow | Existing custom permission checks and some privileged record loading | Apply explicit job/form/site context, field redaction, file and aggregate access consistently |
| Forms `cms-actions.ts` | Stores approver then rechecks through local API | Bind approval/destination to owning site and current policy revision; preserve existing builder |
| `src/review/documents.ts` | `isAdministrator` uses legacy global role | Operator is separate; nonprofit administration must not expose personal private tasks |
| Workspace/project access | Team means any authenticated user; owner/operator shortcuts | Explicit organizational team scope for new items; compatibility audience for historical records; private exceptions stay private |
| Review/workspace/project collections and service endpoints | Privileged reads/writes rely on upstream checks | Central authorization context; verify every endpoint/count/relationship population and mutation |
| Project sharing, workspace fields/formulas/files | Shared audiences, references and protected files | Intersect CRM record policy with board access; approval revision invalidation; no restricted aggregates or donor metadata leaks |
| Mentions/notifications/starter workspace | User lookups and durable generated events; private starters | Eligible-user lookup only; current permission check when rendering notifications; do not claim starters for nonprofit sites |
| Time mutations/time reporting | Task access and owner/manager visibility | Preserve personal time privacy and existing access while adding explicitly site-owned work |
| Board overview/Dashboard/search | Authorized existing aggregates | Extend query-level predicates to site/CRM restrictions; never calculate totals from current page |
| Public App Router/rendering/content framework/menus | Single-site globals and global slug assumptions | Collision-safe scoped routing, source placements, host verification, publication/revocation-aware cache keys and canonical URLs |

The initial search found 216 matching lines involving administrator shortcuts, team visibility or `overrideAccess:true` across the examined collection/global/Forms/review/Dashboard/application directories. This is an audit input, not 216 proven vulnerabilities. Individually review server-trusted reads and preserve legitimate internal operations; do not mechanically replace flags.

## Release gates

- [x] Scoped content ownership and native API predicates, including drafts, versions and counts.
- [ ] Root-compatible settings and per-site records; scoped account/member management.
- [ ] Scoped Forms/runtime/jobs and destination approvers.
- [ ] Scoped team workspaces and preserved historical/personal audiences.
- [ ] CRM-to-board privacy intersections for every derivative surface.
- [ ] User discovery, mentions, notifications, attachments and exports.
- [ ] Public routing, menus, search, feeds, previews and caches.
- [ ] Separate-account integration/browser matrix and existing-data upgrade tests.
- [ ] Review migration SQL and record recovery point before production apply.

Production organization administration remains unregistered. The isolated local runtime now exposes `/admin/sites` and `/api/organization-admin` for review; registration requires an explicit local persistence path. Actors come from authenticated server context, never request JSON. Production tenant onboarding remains gated.

## Authority and financial checkpoint

- Membership restrictions now narrow individual category/operation capabilities. Scoped identity administration cannot remove its own finance restrictions or delegate broader roles than it can exercise. Ancestor ceilings and revision fences still apply.
- Operator-controlled account deactivation preserves user IDs and history. Request-time guards cover registered custom endpoints, native/Local API collection operations, global reads/updates and login. A server-only Symbol permits migration tooling through partially upgraded authority schemas; HTTP JSON cannot impersonate it. Bootstrap without organization tables remains supported. Background jobs that omit authenticated actor context still need the job-specific reauthorization work above.
- Last-administrator checks exclude disabled accounts. This does not yet replace legacy `role === 'administrator'` shortcuts with scoped capabilities across CMS, Forms, Tasks or account-management interfaces.
- Finance services use explicit chapter scope, independent finance capabilities, current authority checks and atomic audit/receipt writes. Contact identity access alone does not allow gift access. Funds must belong to the gift's chapter, including a database check against races; original gift amounts and allocations remain immutable.

Tenant onboarding and context switching remain unexposed. The full tenant-isolation release gate is still open; these guards do not make all existing systems site-aware.

## CMS, Forms, and Tasks checkpoint — October 21

- CMS collections now have server-owned site metadata, site-scoped native list/count/ID/version access, immutable ownership, per-site slugs, relationship validation, and primary-D1 authority-epoch write guards. Read and restore paths cover native operations that capture `overrideAccess` before hooks. Root public rendering remains on the compatibility site. Concurrent permission discovery shares one bounded initialization.
- Native account access uses a membership-derived directory. Installation operators remain separate from the legacy account role. New site administrators do not become operators; account creation provisions explicit site capabilities. Server-derived, serializable authority metadata survives native authentication without passing internal Symbols into React. JSON copies are never accepted as server authority.
- Forms staff APIs use current Forms/submission capabilities, immutable site assignment, and native read/version predicates. Historical entry-schema reads and audit writes use separate internal requests so sensitive-field redaction cannot be accidentally disabled on the caller. Export workers reauthorize their saved requester in the job's site before each page and before publishing the private file. CMS actions reauthorize the saved approver in the job's explicit destination site.
- Team projects and boards have an owning site. Historical private work and starters remain personal. A database-maintained audience projection applies owners, explicit members, project inheritance, private exceptions, team audiences, and archival in bounded native predicates. Distinct join aliases prevent native alias reuse across Inbox task/board/project branches. Native reads/counts, comments, placements, and notifications reuse these predicates. Audience mutations include policy epochs in their approval fingerprints and atomic guards; cross-site moves fail closed. Starter initialization reads its own durable marker directly without exposing private account fields.
- The additive migrations preserve historical bodies, versions, relationships, and IDs. Native lock-relationship columns and the exact generated index names travel with the snapshots. Local upgrade verification preserved all 131 historical application tables, verified 51 native ownership indexes, and was repeat-safe.

This checkpoint is superseded locally by the desktop continuation below. Site-specific settings, public subsite routing, and CRM-reference privacy intersections for the unimplemented workflows remain release work. Production tenant onboarding stays unexposed. Passing an integration subset does not satisfy the complete approved release gates. No production migration or deployment has been performed.

## Desktop continuation: local administration and commit guards

- Native account, Forms, and workspace mutations carry a final server-generated actor/site/epoch proof. Database triggers reject stale account/site authority, including Forms draft versions. Mutation proof fields are scrubbed even from privileged reads and cannot be supplied through HTTP JSON. Every collection rejects proof-based filters, counts, distinct values, sorts, and joined selections, preventing inference through a related record. Account provisioning also fences its capability writes. The additive `20261022_010000_native_mutation_guards` migration adds 48 proof columns, including the Forms version column, and retains existing IDs, content, and audience projections.
- Workspace proofs capture task revisions and board/project audience revisions before existing permission hooks. Native mutations/deletes and raw task-field, dependency, time, placement, and view mutations validate those witnesses at commit. This catches board/project membership changes independently of organization policy epochs. Existing reviewed sharing keeps its more detailed audience checks.
- Nested Local API calls cannot silently replace an in-flight request's old authority epoch. Export publication is fenced in the same D1 batch as the completion update; failed publication removes the staged private object. Forms/export/workspace downloads check authority after storage retrieval and cancel undelivered bodies on denial. Durable notifications continue to resolve their stored source and recheck recipients.
- Local administration supports organizations, nested sites, memberships, category restrictions, inherited policies and explanations, explicitly reviewed read/edit sharing, and audited moves. Source and destination authority and revisions are checked. Roots, cycles, cross-organization moves, and subtrees larger than 200 sites are rejected; larger hierarchy jobs remain unimplemented. Site lists omit denied records and encrypt actor-bound continuation cursors; member and grant lists are paginated.
- Site preference changes use revision checks. Native editors carry a virtual `editorSite`; a conflicting explicit context fails rather than retargeting a save. CRM reads and saves stay pinned to the editor's site, including focus refreshes. The local CRM selector opens an explicit site; `/admin/sites` can save the default for new editors. Existing personal work retains its ownership and privacy rules.
- Administration endpoints require native authentication and same-origin mutations. Only successful audited authority mutations acknowledge their intentional epoch change; ordinary responses retain their final authority check. New administration routes remain absent from production configuration until the full rollout gates pass.

The local screen is available when starting the app with an isolated `DESIGN_CORE_TEST_PERSIST_PATH` or `E2E_TEST_PERSIST_PATH`. Use fictional fixture accounts and the local tracked migration helper. No real email, production migration, or deployment is part of this checkpoint. Per-site public settings/routing, large hierarchy jobs, and future CRM-linked board privacy remain unfinished.

Verification: the final focused run passed 65 integration tests across nine files, including 24 organization storage cases covering private-proof query denial and mutation races. Another 29 native workspace cases and five browser scenarios passed; migration upgrade/retry retained 131 historical tables, 51 ownership indexes, and 48 proof columns. Scoped native file stage/upload/download/delete and privileged proof redaction also passed. Earlier TypeScript and local Worker build/dry-run passed, but the final shared-folder rerun is blocked by newly arriving OneDrive duplicate declarations and a missing generated design-package export; the latest Docker build rerun also failed without a useful diagnostic. These files were not overwritten or removed. Reconcile that unrelated folder state and repeat the final checks before treating this as release-ready; see the CRM implementation checkpoint for details.

## October 23 combined release candidate

The shared-folder conflicts above have been preserved and reconciled. The current candidate registers administration through the explicit server-controlled `ORGANIZATION_ADMIN_ENABLED` setting. Scoped settings currently cover private site identity; installation globals and existing public URLs remain compatibility-owned. This is private CRM/workspace onboarding, not public subsite publishing.

Global updates now carry a final authority proof checked by D1 for inserts and updates. System Settings also checks current operator status. Proofs are stripped from privileged reads. Public Navigation has a server-only default-site read path and a final authority fence; public HTTP JSON cannot select that path.

Native account authentication is kept separate from staff mutations: a full-row native authentication upsert may retain the same stored proof only if every installed account application column is unchanged. Authentication counters, reset tokens, hashes, and salts remain managed by Payload's native authenticated/token flows. Any staff mutation gets a new proof; stale profile, role, and future application-field updates still fail. This fixes login after permission changes without relaxing application writes.

CMS context and authority witnesses survive actual Payload Local API request cloning. The plain context marker preserves server symbols without granting access; registry symbols bridge separate API/RSC module instances so the public renderer retains its explicit default-site permission path.

Release validation passed: 74 focused integration tests, 29 native Tasks/Projects cases, five native menu cases, seven native site-template persistence cases, separate-account/private-file helpers, 232 design-package tests, and all eight release browser scenarios. TypeScript/lint, additive upgrade/retry checks, the optimized Linux build, artifact checksums, and portable deployment dry-runs also passed. Browser validation used an isolated current Wrangler CLI after identifying a disconnect in the pinned CLI's local proxy; production dependencies remain pinned.

Production recovery/deployment evidence is recorded under the ignored `.wrangler/releases/20261023/` directory. The current checkpoint still awaits production apply/deployment and authenticated smoke tests. Future CRM-to-board references must implement privacy intersections before they are introduced; this release introduces none.

### Production release receipt — October 23, 2026

Source commit `21e1bf4cba75ac24f613d474ea4d1c178e1c6a2a` is deployed as Worker version `8d11c6bd-7ad5-4601-ac68-0a56f89202b9`, with production Sites administration enabled. All ten additive migrations completed, bringing the Payload ledger to 41 (batches 25/26). Production verification preserved row counts across all 137 historical tables and confirmed 51 ownership indexes, 48 native proof columns, six Global guards, and two authentication guards. The final four unchanged migration functions used the authenticated D1 API after the native CLI remote proxy disconnected.

Signed-in dashboard/private workspace counts, CRM editor opening/cancellation, site membership, effective-permission explanations, and public rendering passed production smoke checks. Anonymous administration/users/private-task requests were denied (401/403/403). Contact/gift/refund writes, revocation, exports, and cross-site scenarios passed isolated tests; no fictional production records were introduced. Operational evidence and the pre-apply recovery point are retained in ignored `.wrangler/releases/20261023/`; the implementation plan records exact recovery identifiers. Public subsite routing, later CRM workflows, and CRM-to-board privacy intersections remain outside this release.

### Integrated SubSites candidate — October 23, 2026

The next candidate resolves child public context at the Worker boundary, removes untrusted context headers, and scopes rendering, links, metadata, native media, menus, Forms, and supporting endpoints to that site. Child delivery requires initialization, publication, and enabled/unarchived ancestors. Availability and authority revisions are checked again before delivery; public submissions include the authority epoch inside their acceptance transaction. Preview requires current staff read authority. Installation-operator status does not bypass public availability ceilings.

Feature controls, settings, initialization, and publication use revision checks, audited operations, and final authority guards. Failed initialization retains an unpublished child and reuses uniquely identified completed design copies on retry. Independent copies omit content, private work, and internal navigation to uncopied records. Site Settings → SubSites reuses existing membership, restriction, sharing, and move services; CRM uses Payload's standard admin template.

Copy-identity fields remain hidden from ordinary reads and query filters; only a server-owned initialization context can use their retry lookup. Native nullable presentation values normalize safely on save. Copied named menus retain safe external links, promote them when an uncopied parent is omitted, and remap the selected menu to its child-owned copy. The pause review lists authorized, loaded descendants without disclosing restricted site names. Publication/editor actions wait for the post-save revision refresh.

Local verification passed 75 focused integration cases, 238 design-package tests, ten release browser scenarios, TypeScript, lint (no errors), optimized Linux Worker build, and Linux/portable deployment dry-runs. Native branding copies, default/child public Forms context under staff site switching, private account-draft request routing, duplicate slugs, canonical URLs, inherited pause, and private XLSX/receipt denial passed browser checks. Additive upgrade/retry retained 161 historical application tables. The test fixture's missing historical Forms operational tables were initialized separately; production already contains them. Production rollout remains pending. Preflight confirms only `20261023_200000_subsite_websites` pending, no `/sites` page collision, and the existing administrator. Recovery and checksum receipts are separate under ignored `.wrangler/releases/subsites-20261023/`. Custom domains/subdomains, large hierarchy moves, future CRM phases, and CRM-to-board privacy intersections remain unfinished.
