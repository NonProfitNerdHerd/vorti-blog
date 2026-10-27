# Permissions, Settings, and corrective release — October 27, 2026

Production: [VortiCause](https://vorti-blog.ike-j-rebout.workers.dev). The corrective release is live and verification and cleanup are complete.

## Deployed application identity

| Item | Verified value |
| --- | --- |
| Application commit, pushed to main | `c2c154c1909b2539f023eeeac3bffef7bc4b2e19` |
| Artifact SHA-256 | `35106f153dd8093629fdaaeba4afc10a72362ea905f5dd5ac6941eab7536450c` |
| Source archive SHA-256 | `a84f16053e9c74ef5dcf16b83b29ccfacc1dbdaf074e18cafef57170f0456533` |
| Isolated build configuration SHA-256 | `7987b0fcb96e4c2e06ed1d86e61536aeb9cbf343fb63f790f603f3bc2f6056b1` |
| Active bindings/runtime configuration SHA-256 | `12328852e9a5c12bd1f0470062b243f60ac2b09f5ddd5e2786db67ba1229b486` |
| Migration chain SHA-256 | `3ce79a7cb4f96cccaf2fb78c80b87fb10d7e19e316301c258cace02ec10e688f` |
| Deployment | `0cec1f45-5082-4321-9c8a-bc8fe60b62f6` |
| Worker version, 100% traffic | `4bc82577-4d9f-4c77-a375-8f090a170ee1` |
| Deployment time, UTC | 2026-10-27T18:37:56.190789Z |
| Artifact inventory | 143 files |

The exact tested package was deployed without rebuilding. This receipt is committed and pushed in a later documentation-only commit; that commit does not change the deployed application and requires no redeployment.

## Correction and validation

The Features screen now loads the saved Categories value and scoped settings revision. Feature managers without Settings permission receive an explanation in place of the Categories control. Database errors remain visible. Generated Payload types have an explicit LF policy; Cloudflare declarations include the existing OPERATIONS binding. Binding generation, production build, and packaging leave tracked source bytes unchanged, with the exact fingerprint guard retained. The artifact inventory excludes test fixtures and secret material. The health client fully drains streamed page responses so completed Worker telemetry can be verified; interrupted streams fail the check.

Fresh validation against the frozen application commit passed:

- TypeScript and error-only lint.
- Complete integration run: **760 tests across 189 files**, retaining the native 60-second test budget and existing assertions.
- Shared design/editor: **239 tests across 45 files**.
- Production build, exact source fingerprint, packaging, and artifact verification.
- Full browser acceptance: **18 passed in one uninterrupted run**, no skipped, unexpected, flaky, or retried cases, against this artifact. Coverage includes Task autosave/draft recovery, rapid entry, subtasks, dialogs, timeline/dependencies/calendar, CRM completion, Settings/Categories, Wiki, and responsive workspace behavior.

Live administrator identity 1 was independently confirmed on the new Worker using the existing credentials and renewed session. General, Reading, Privacy, Features, Roles, Tasks, Wiki, and authenticated Intranet loaded successfully. Categories began enabled, saved/reloaded disabled, then saved/reloaded enabled; its pre-test value was restored. Anonymous public and unauthorized private probes passed, including no-store knowledge responses and confirmation that the operational probe grants no user identity. Substantive business mutations were confined to isolated browser fixtures.

## Migrations, preservation, and recovery

This correction required **no migration and no reset**. All **61 registered migrations** already matched the live ledger, ending with `20261027_000000_tenant_authority`; foreign-key checks passed. No applied migration was rerun and no installation seeding ran during this cutover.

The original development reset retained the administrator credentials and recreated the Default tenant/site, Tenant Administrator assignment, one built-in template, and four built-in designs. Old posts, pages, media, Tasks, CRM, workflow, and knowledge records were verified absent before reopening. The current starter project and personal board are newly created installation behavior. This correction preserved the current database/storage, records, secrets, and queued jobs; before/after hashes of record identities matched across ten application tables. No current queue messages were purged.

Production/source/bindings/ledger were rechecked before maintenance and immediately before upload. The corrective recovery baseline was deployment `e91e85c3-51d0-4ba3-9324-31642c843d8c`, Worker `7b779096-c79d-4d9f-9af0-41418a536d74`, using the current application resources. Queue delivery was paused, ordinary writes fenced, and in-flight work drained. The fresh export was restored in isolation and passed integrity, foreign-key, and 61-migration checks before upload. Queue delivery resumed after initial verification. The separate original reset baseline was retained solely for the approved old-resource cleanup.

## Health acceptance

After live probe telemetry was confirmed, one continuous observation passed for **610 seconds**, with **101 correlated successful probes**, **0 Worker exceptions**, and **0 server errors**, from `2026-10-27T18:41:09.352Z` through `2026-10-27T18:51:20.122Z`. Every probe required the expected HTTP status and corresponding live telemetry; unexplained gaps, disconnections, missing telemetry, or failed probes would invalidate the window. The active deployment was rechecked after observation. The earlier observations that failed log coverage, canceled streamed responses, or encountered local transport resets were not counted. Live observation used native curl with fully consumed responses and a separate connection per probe after Node fetch attempts encountered transport resets. The same mandatory telemetry and functional assertions remained enforced. The release lease reached `complete` before cleanup.

## Resource and temporary-material cleanup

Current resources remain bound and preserved:

| Resource | Identity |
| --- | --- |
| Application D1 | `vorti-blog-bbf925205f7a-app` / `f317a17c-ac2d-418b-a687-0f5eca8e42c3` |
| Operational D1 | `vorti-blog-bbf925205f7a-ops` / `de36bfca-fba9-4877-afc3-52f51a8bdb69` |
| Public R2 | `vorti-blog-bbf925205f7a-public` |
| Protected R2 | `vorti-blog-bbf925205f7a-private` |
| Queue | `vorti-crm-jobs` |

After successful acceptance, health observation, completion of the lease, and another live deployment/bindings check, only these approved obsolete resources were deleted:

| Deleted resource | Identity |
| --- | --- |
| Old application D1 | `vorti-blog-reset-20261025-v2` / `05faeee6-e691-49d0-85b6-c85cae97decc` |
| Old public R2 | `vorti-blog-reset-20261025` |
| Old protected R2 | `vorti-workspace-reset-20261025` |

All nine inventoried temporary SQL/SQLite recovery files and the temporary local operational credential file/pointer were removed after resource cleanup. Deployed secrets remain. Sanitized hashes, validation/health receipts, and non-sensitive operational evidence remain; no recovery export or secret is committed. Only this release's temporary validation/preview runtimes were stopped; unrelated runtimes/resources were retained.

## Operational documentation

See [Tenant installation and release](tenant-installation-and-release.md) for install, data-preserving upgrade, explicit development-reset, configuration, maintenance, recovery, health observation, cleanup, and external-effect reconciliation. Normal upgrades preserve data. Legacy GraphQL global-setting writes continue to fail closed with a conflict response; supported canonical REST/Local API settings paths use the authoritative scoped store.
