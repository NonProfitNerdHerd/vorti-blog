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

- [ ] Scoped content ownership and native API predicates, including drafts, versions and counts.
- [ ] Root-compatible settings and per-site records; scoped account/member management.
- [ ] Scoped Forms/runtime/jobs and destination approvers.
- [ ] Scoped team workspaces and preserved historical/personal audiences.
- [ ] CRM-to-board privacy intersections for every derivative surface.
- [ ] User discovery, mentions, notifications, attachments and exports.
- [ ] Public routing, menus, search, feeds, previews and caches.
- [ ] Separate-account integration/browser matrix and existing-data upgrade tests.
- [ ] Review migration SQL and record recovery point before production apply.

The new foundation repository currently has no registered public endpoint or custom admin screen. Its actor must come from authenticated server context, never request JSON. This keeps partial integration from enabling unsafe tenant onboarding.
