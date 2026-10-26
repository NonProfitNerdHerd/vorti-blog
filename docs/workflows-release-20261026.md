# Workflows production release — 2026-10-26

Production: https://vorti-blog.ike-j-rebout.workers.dev/admin/workflows?workflowView=create&site=default

The left navigation now contains Workflows with Create Workflows, My Workflows and Shared Workflows. Create offers five starter templates and a blank builder. Published templates can be shared within the selected site and copied into a recipient's own draft. Existing record permissions continue to govern execution.

## Released application

- Application commit: `eb5a9cc4085a483f705b87f112131e6d568797f9`, merged and pushed to main.
- Source tree: `2d6b1fcd7fac519626e63588f1ed3dbce9f2e5bd`.
- Worker SHA-256: `6e732fd034818820c678299e8b867f0468ff5257bc3124050cf32a1f2efa25d0`.
- Worker version: `716640f2-d308-4399-9880-0864dfac963f`.
- Deployment: `e9b37124-4f34-4dc8-bedc-f297564ed55d`, 100%, 2026-10-26 19:23:44 UTC.
- Build ID: `ZLye8eKVZShhvY45rjyJF`.
- Tracked migration: `20261026_130000_automations`; production ledger 59, foreign-key check clear.

The retained artifact was built with Node 22.23.2, pnpm 10.28.2 and Wrangler 4.152.0. All 1,422 tracked source inputs were verified against Git blobs, allowing explicit CRLF-to-LF normalization for Windows text archives. The manifest checksums 134 Worker/assets files. Deployment used the retained artifact with `no_bundle: true` and `keep_vars: true`; it did not rebuild. Production D1/R2/Queue bindings and existing secret names were checked against the previous version. The cron and disabled live-email setting remain configured.

## Validation

- TypeScript passed. Lint: zero errors, 1,077 warnings.
- Optimized Next/OpenNext build and production deployment dry-run passed.
- Full integration run: 163 files passed, one project-workspace file had four 30-second timeouts and one downstream assertion failure (672/677 tests passed initially). Its first complete isolated rerun passed 25/26. A filtered timer attempt could not run independently because it relies on prior membership setup. The final complete rerun, after build/browser workloads finished, passed all 26 unchanged tests with the original 30-second timeout; the timer/privacy test took 21.6 seconds. Together the full run and final rerun cover all 164 files and 677 tests successfully. No assertions or timeouts were relaxed.
- Final navigation/UI checks passed separately after the last navigation change.
- All 28 checkpoint browser tests passed against the exact frozen artifact, including workflow templates, draft save, publish, sharing, copying and mobile layout.
- Production read-only authenticated checks passed for the dashboard, CRM, Posts, Forms, Tasks/projects, Create Workflows, My Workflows, Shared Workflows and the unsaved blank builder. No test records were saved in production.
- Production build ID, build manifest and a static JavaScript asset matched retained SHA-256 checksums.
- Ten-minute production observation completed successfully (2026-10-26T19:24:22.510Z to 2026-10-26T19:35:19.173Z): 261 Worker events, 120/120 route/access checks, zero exceptions, zero server errors, and no unexpected tail exit.

Validation evidence and the frozen artifact are retained locally under `.wrangler/releases/workflows-20261026/final/`. This receipt is a documentation-only follow-up; the deployed application commit remains the one recorded above.

## Recovery

Previous Worker: `8d35a6fd-3be1-45b5-a649-f13f9965b7d3`.

Pre-migration D1 Time Travel bookmark: `000000c1-00000026-00005110-87adcca7e3fa1f8a053558880342bae7`.

The migration retains workflow definitions and history. Recovery requires the reviewed matching Worker/database state rather than a destructive down migration.

The scope and deferred capabilities are documented in [automations.md](automations.md).
