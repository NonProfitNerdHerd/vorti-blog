# Unified publishing: compatible recovery deployment

This receipt covers the audience-safe compatibility stage. The unified editor,
portal, sharing and content-conversion implementation is **not yet released**.

- Production: https://vorti-blog.ike-j-rebout.workers.dev
- Application source: `4f2867776f0da8a6cc7ef5db72bb4fbd75ff02fc`.
- Artifact SHA-256: `63ecc2957451156d325601270bad30cb148fbe87f8860bf9a8c8ace987eeaad7`.
- Deployment: `f0380551-1675-4541-b909-4e80dafa55c2`.
- Worker version: `93a2033c-9539-4ff8-b818-87983cd1a9a1`, receiving 100% of traffic.
- Operational upgrade run: `f8400c74-71f6-48e9-bbb0-85f5ffef98ca`, complete.

## Validation

Frozen Linux validation passed TypeScript, error-only lint, 771 integration tests
across 193 files, and 239 shared-package tests across 45 files. Production build,
packaging and unchanged source-byte fingerprints passed. All 18 browser scenarios
passed in one complete invocation against this exact package, without retries or
skips. These results apply to the compatibility commit, not the separate unfinished
implementation worktree.

An earlier browser run was invalidated by a network interruption. Its evidence was
retained; its partial results were not combined with the complete passing run.

## Migration and cutover

The database advanced from 61 to 62 registered migrations, applying only
`20261027_230000_publishing_audience_compatibility`. This adds public-default
audience metadata to shared collections and their versions. It introduces no
internal shared-collection records and does not convert or discard content.

Queue delivery was paused without purging messages. HTTP maintenance and database
write guards protected a fresh recovery export, which restored successfully with
SQLite integrity `ok` and no foreign-key violations. Immediately prior Worker and
bindings were retained as the recovery baseline. The tested immutable artifact was
uploaded without rebuilding. Its successful upload was reconciled against the
Wrangler upload log, independently inspected active deployment and Worker bindings
after a network failure interrupted the command's post-upload status check.

Database guards were removed only after deployment identity and the complete
migration chain were verified. Protected verification confirmed the administrator's
existing session and expected public maintenance response. Access reopened and
preserved queue delivery resumed. No infrastructure bindings or credentials changed.

## Live verification and health

Verified administrator identity, dashboard, Settings and saved enabled Categories,
Tasks with the existing project/board, Wiki, authenticated legacy Intranet, public
responses and anonymous private-route denial. Fresh inventory found zero imports,
exports and legacy Intranet pages; the final upgrade must recheck rather than assume
that remains true.

The first health attempt failed its telemetry-coverage gate after 125 seconds,
despite zero observed errors. It does not count as acceptance. The restarted window
passed **610 continuous seconds**, **101 correlated probes**, zero observed Worker
exceptions, zero server errors, and no failed probes or unexplained coverage gaps.

## Recovery and remaining release

This is the tested audience-aware recovery Worker for the upcoming unified
migration. A pre-audience Worker must never be restored against shared collections
containing internal records. The compatibility Worker also fails closed on retired
legacy Intranet operations once unified migration mappings exist; Wiki is unchanged.

Private recovery exports, restored copies and isolated runtimes remain inventoried
under the ignored release workspace because the final release still needs recovery
protection. They must be removed only after final acceptance. No unrelated or old
development resources were deleted. The later documentation commit is distinct
from the application commit above and does not require redeployment.
