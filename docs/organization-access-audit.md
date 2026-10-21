# Organization rollout: existing-system access audit

This is the implementation checklist for Phase 1. It is not a claim that current VortiCause is already an isolated multi-organization installation. Tenant onboarding remains unexposed until the integration below is complete.

## Current source findings

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

The new foundation repository currently has no registered public endpoint or custom admin screen. Its actor must come from authenticated server context, never request JSON. This keeps partial integration from enabling unsafe tenant onboarding.

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

This is still a partial integration checkpoint. Remaining release work includes site/member/context administration, site-specific settings and public subsite routing, the remaining raw-job/mutation and file-route audit, and the CRM-reference privacy intersections needed by the unimplemented workflows. In particular, ordinary Forms/Tasks mutation commit fences still need the final review applied to CMS writes. Tenant onboarding stays unexposed. Passing this subset does not satisfy the approved release gates. No production migration or deployment has been performed; the user's existing release authorization remains in effect.
