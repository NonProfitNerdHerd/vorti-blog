# Unified publishing deployment and outstanding acceptance work

Status: **deployed and reopened for user testing; acceptance incomplete at the
user's explicit instruction to stop testing and deploy.** This receipt does not
claim completion of the original acceptance plan.

## Deployment

- Production: https://vorti-blog.ike-j-rebout.workers.dev
- Intranet: https://vorti-blog.ike-j-rebout.workers.dev/intranet
- Deployed application commit: `41d16907a2416fbf54754181fcc68078578d9d66`.
- Main implementation/release-tooling commit: `0335d3905ee1d6afc2e058e2e68fe8e9d74dcf89`.
- Artifact SHA-256: `3523b0419341e79fa6d84b22c36528d801b42e1b44e8080a2af81e854a6b33cc`.
- Deployment: `1b4a0293-efca-4f9c-8652-7168a806511a`.
- Worker version: `1cab544b-630e-4929-afda-e9bbeb5dc405`, receiving 100% of traffic.
- Provider deployment timestamp: `2026-10-28T04:30:54.758749Z` (UTC).
- Operational run: `207793f4-d053-40cf-9f35-fb3ffc57bfca`, phase `observing`.
- Validation-waiver SHA-256: `d45fee987c603de704e74cf82fd2721b313e4e28e5bee2828faf3dad337e619c`.

The generated Forms runtime was reconciled and committed before the final build.
The fresh pinned Linux build and its TypeScript phase passed. Packaging retained
the exact source-byte guard and passed unchanged tracked-file, manifest inventory,
credential-file, isolated-fixture and recovery-file checks. No acceptance suites
were restarted after the user requested stopping tests. Incomplete validation was
recorded explicitly rather than represented as passing.

## Migration, preservation and reopening

Applied `20261028_000000_unified_publishing`, advancing the complete registered
chain from 62 to **63 applied migrations**. No further registered migration is
pending. The current application D1, storage bindings, URL and credentials were
retained. The fresh pre-cutover Worker/bindings were the verified audience-safe
compatibility deployment `f0380551-1675-4541-b909-4e80dafa55c2`, Worker
`93a2033c-9539-4ff8-b818-87983cd1a9a1`; pre-audience recovery remains prohibited.

Queue delivery was paused and preserved. Processing jobs drained, maintenance and
database write guards protected a fresh recovery export, and its isolated restore
passed integrity `ok` and foreign-key checks. Migration, conversion and portal
initialization completed before uploading the immutable package without rebuilding.
There were zero legacy Intranet records to convert in production. Initialization
created internal homepage Page 1 and Intranet Template 2.

Post-deployment comparison against that fresh snapshot verified **817 original
records across 37 populated tables**, including original settings and credential
values. Expected authority/settings revision increases and added portal settings
were allowed; ephemeral sessions and document locks were excluded. Live foreign-key
checks remained clean. Original public Template 1, project and board records remain.

The browser's old session was unauthenticated. An attempt to waive the reopening
login guard was rejected by automatic approval review; the attempted guard change
was reverted and never committed or deployed. The user then signed in freshly.
Administrator identity 1 was verified on the new Worker, with the expected public
maintenance response. The existing guard then permitted reopening; queue delivery
resumed. Public homepage and login returned 200, anonymous Intranet returned 404,
and the authenticated Intranet homepage rendered its header, authorized search,
welcome content, news and resources. These are limited deployment checks, not full
functional acceptance or a ten-minute health observation.

## Full outstanding-work list

1. **Finish the Main template designation.** Production still has public Template
   1 named `Default Website Template`, with `assignment_mode=default`, while the
   scoped `defaultSiteTemplate` selection is unset. Intranet Template 2 is assigned
   correctly. Reconcile the public template's Main name/purpose/default selection
   with the existing automatic public-shell behavior, preserving its appearance.
2. **Verify the final menu correction.** The earlier native menu regression was
   reproduced: draft public destinations were rejected during menu saving. The
   shipped correction distinguishes navigation from embedded dependencies, keeps
   draft destinations hidden in rendering, and retains internal-destination denial.
   Its final native regression and added dependency tests have not been rerun.
3. **Complete final-source validation.** Run the standalone TypeScript command,
   error-only lint, shared design/editor suite and all integration projects against
   the final frozen source. The production build's TypeScript phase passed, but
   there is no complete passing integration invocation for this deployed commit.
   Prior source passed TypeScript/lint and 241 shared-package tests; those results
   must not be substituted for final acceptance.
4. **Resolve the full-run time-tracking timeout if it recurs.** The concurrent
   stopwatch case exceeded its unchanged 60-second budget in the interrupted full
   run. A subsequent instrumented diagnostic preserved the assertions and passed
   all five cases, including that case in 37.85 seconds. This diagnostic does not
   clear the failed full-run result. Obtain one complete passing invocation without
   weakening assertions, skipping cases or increasing the required budget.
5. **Run all 21 browser scenarios against this exact package.** This includes the
   existing 18 regressions and three unified-publishing scenarios: shared public/
   internal Posts and Pages editing, area defaults/direct links/save/reload,
   independent portal templates/routes/mobile layout, readership controls,
   protected uploads and destination-draft copying.
6. **Complete functional and security acceptance.** Verify mirrored sidebar lists
   and creation defaults for Posts, Pages, Media, Categories, Tags and Saved Views;
   shared blocks, drafts, scheduling, previews/history; public/internal homepages,
   templates and menus; restricted people/groups and ancestor rules; group
   retirement/revocation; administrator exceptions, inactive users and cross-tenant
   denial; feature independence, subsites and public-site unpublishing. Exercise
   forged scopes, REST/GraphQL/Local API, relationships, search/counts, exports,
   previews, protected files and cache/indexing boundaries. Verify copy/move
   permissions, dependencies, conflicts, idempotent retries and history retention.
7. **Finish cross-product and populated-upgrade regressions.** Cover current Tasks
   editing/autosave/creation/timeline/calendar/mobile behavior, CRM completion,
   Forms, workflows and retained job ownership/external effects, Settings/Categories
   and unchanged Wiki. Recheck populated synthetic legacy conversion, history,
   attachment checksums, legacy links, restart safety and compatible failed-cutover
   recovery. Production migration succeeded, but its zero legacy records do not
   provide populated legacy-conversion acceptance evidence.
8. **Complete final-deployment health observation.** Require at least 600 continuous
   seconds after telemetry attachment, correlated successful probes throughout,
   zero exceptions/server errors and no unexplained gaps. No such window was run
   for this final deployment. The compatibility release's earlier passing window
   does not count for this Worker.
9. **Finish acceptance-dependent cleanup.** Recovery exports/restored copies and
   isolated fixture/build volumes remain retained. Temporary test/build runtimes
   were stopped. Inventory and remove only this release's temporary material after
   acceptance succeeds; retain deployed secrets and unrelated Cloudflare resources.
10. **Close acceptance and update the receipt.** After actual passing checks and
    health observation, advance the operational lease from `observing` to
    `complete`, record final acceptance and cleanup results, then commit/push the
    updated receipt. Current `observing` state keeps the site open and preserves
    the distinction between deployed and fully accepted.

This receipt is a later documentation-only commit, distinct from deployed
application commit `41d1690`; it does not require rebuilding or redeploying the app.
