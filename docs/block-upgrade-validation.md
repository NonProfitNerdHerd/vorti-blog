# Block upgrade validation - 11 October 2026

## Completed checks

| Check                                                            | Result                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared framework, Template, Site Shell and inspector suites      | 100 tests passed in 21 files                                                                                                                           |
| Integration, permissions, public API, Tasks and migration safety | 37 tests passed in 9 files                                                                                                                             |
| Editor browser suite (Edge/Chromium)                             | 15 tests passed: Hero insertion/switch/undo/save/reload, Template API locks, catalog storage adapters, panels, document header, Tasks and region links |
| Application TypeScript                                           | `tsc --noEmit --incremental false` passed                                                                                                              |
| Shared package rebuild                                           | Passed; tracked dist output refreshed                                                                                                                  |
| Lint                                                             | No errors; 31 existing warnings; generated local artifacts excluded                                                                                    |
| Production Worker build                                          | OpenNext completed with wrangler.test.jsonc and local test bindings                                                                                    |
| Wrangler dry run                                                 | Passed; 150 static files, 4129.97 KiB gzip Worker; no deployment                                                                                       |
| Layout fixture                                                   | 19 families at desktop (1440), tablet (900), phone (390), dark phone/reduced motion; no horizontal overflow in 57 captures                             |

The browser suite passed before the final isolated background-picker race protection and preset contrast refinements. Those final changes passed the shared suite, TypeScript, lint, and Worker build. The review fixture waits for suspended renderers instead of capturing loading fallbacks.

## Reproduce locally

```powershell
$env:BLOCK_REVIEW_PATH = Join-Path (Get-Location) '.wrangler/block-review'
corepack pnpm --filter @design-system/payload-design-core test
corepack pnpm --filter @design-system/payload-design-core build
corepack pnpm exec tsc --noEmit --incremental false
corepack pnpm lint --ignore-pattern '.wrangler/**' --ignore-pattern 'test-results/**' --ignore-pattern 'playwright-report/**'
```

Open `.wrangler/block-review/block-layouts.html` directly. Embedded geometric media requires no external service. Filter with `?family=hero&dark` (use other definition types as needed). Screenshots/contact sheets are in the same local directory. These are rendered layout fixtures, not separate browser tests for every setting. Consult `block-coverage-audit.md` for narrower implementations.

Integration tests require a dedicated initialized local database via `DESIGN_CORE_TEST_PERSIST_PATH`; run `vitest run --config vitest.config.mts --testTimeout=30000`. The passing run used `.wrangler/review-final-integration`. Earlier interrupted tests left fixed-name records behind; only those local fixtures were removed before the successful run. Never point tests at production.

## Storage and deployment boundary

The block upgrade extends existing JSON and does not add collection fields or database columns. Payload type/configuration and migration changes already pending in this working tree belong to Tasks (review-tasks, review-comments, review-activity). Existing content JSON fields and published collection shapes remain intact. No block migration or dependency-manifest changes were added.

The Tasks additive migration regression passed. A separate replay of the entire historical migration chain into an empty local database stopped in the existing `20260918_135802_design_system_stage3` data-seeding migration. This clean-install issue is not represented as a successful migration check and was not changed here. No production migration was attempted.

Windows caveat: OpenNext warns that Windows is not fully supported. Validation used the existing local junction helper. The Wrangler dry run needed one generated absolute Windows import for Geist-Regular.ttf.bin normalized to a relative asset path in .open-next; source/dependencies were not altered. Use the supported Linux build environment for deployment.

No commit, push or production deployment occurred. Pending Tasks/sidebar work and unrelated src/system-management files remain intact. Generated AGENTS.md/CLAUDE.md remain in place after automatic approval review rejected their removal.
