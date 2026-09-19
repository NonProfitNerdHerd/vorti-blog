# Design Core Stage 3.5: local validation and future rollout

Stage 1 through 3 remain local work. This document prepares a later production rollout; it does not authorize one.

## Resource boundaries

- Development: `next dev` uses Wrangler's local bindings. Set `DESIGN_CORE_TEST_PERSIST_PATH` to a native Linux directory when repeatable local data is needed.
- Test: use a dedicated `DESIGN_CORE_TEST_PERSIST_PATH`, a local only Wrangler proxy, one Playwright worker, and `wrangler.test.jsonc` for the OpenNext Worker build. The test Wrangler config has a distinct D1 identifier and `remote: false`.
- Production: `wrangler.jsonc` binds the production D1 and R2 resources. Production migration and deployment scripts require `DESIGN_PRODUCTION_MIGRATE=YES` and `DESIGN_PRODUCTION_DEPLOY=YES` respectively. They reject `DESIGN_CORE_TEST_PERSIST_PATH`.

For local validation, build the package, run TypeScript and tests, run `pnpm build`, then `pnpm build:worker:local`. Set `PAYLOAD_SECRET` only in your own shell; never commit it. The local preflight is `pnpm design:preflight:local`. It requires `DESIGN_CORE_TEST_PERSIST_PATH` and runs read-only D1 queries against exactly that isolated state.

Playwright runs one worker because several concurrent browser workers caused local Miniflare D1 `SQLITE_BUSY`. Browser test document and media setup uses the application's HTTP API so the test worker does not open a second Miniflare connection for routine writes. Live Preview timings in this harness include Next dev compilation, browser iframe loading, and local Miniflare latency; they are not production request benchmarks.

The remote preflight is `pnpm design:preflight:production`. It uses `wrangler d1 execute --remote` for `SELECT` and `PRAGMA table_info` queries only. It prints whether `DESIGN_ADMIN_EMAIL` is present, whether exactly one existing User matches, User/Post/Page counts, Stage 1/2/3 migration records, relevant schema state, and a static scan for destructive operations in the `up` functions. It never prints the configured email or secret values. It does not migrate. Run it only during an approved production window. A Cloudflare OAuth login can authenticate even when `cloudflareTokenEnvironmentPresent` is false.

Stage 2's app migration requires `DESIGN_ADMIN_EMAIL` to match exactly one existing User before any Stage 2 writes. That User receives administrator; every other existing User defaults to editor. No package code assigns roles. New Users continue to default to editor. If the email is absent or mismatched, the migration throws before changing schema or records. A fresh, empty Users table needs no backfill.

## Production rollout order, after separate approval

1. Export or snapshot production D1 and confirm a working restore point. Record the current deployed Worker version and configuration.
2. Validate Cloudflare authentication and required environment variables in the operator's shell, including `DESIGN_ADMIN_EMAIL`, `PAYLOAD_SECRET`, and the intended `CLOUDFLARE_ENV`. Do not paste values into tickets or logs.
3. Confirm the selected existing administrator can currently sign in. Run the read-only administrator role preflight and require exactly one match.
4. Run the read-only production database preflight. Review Users, Posts, Pages, migration records, schema state, expected changes, and destructive-operation scan. Stop on any mismatch.
5. Build the exact approved commit in native Linux with fresh dependencies. Require package tests, app tests, browser tests, Next build, and the local Worker build to pass.
6. During a controlled maintenance window, set `DESIGN_PRODUCTION_MIGRATE=YES` and run `pnpm deploy:database` with the reviewed environment. Inspect migration output before proceeding.
7. Set `DESIGN_PRODUCTION_DEPLOY=YES` and run `pnpm deploy:app` for the same commit and environment.
8. Open Payload Admin and verify it loads with the expected collections.
9. Sign in as the selected current administrator and confirm Block Creator and Templates access. Confirm an editor cannot manage global designs.
10. Open Block Creator, inspect the seeded Hero Board variants, and test a draft without changing live content.
11. Open Templates, inspect Standard Article and its default Design reference, and test draft preview.
12. Inspect an existing Post, its drafts, SEO values, and public route. Test repeated Draft saves on a test Post.
13. Inspect an existing Page and its public route; Pages are not Template-enabled in Stage 3.
14. Check that existing Post and Page SEO metadata remains present in Admin and public HTML.
15. Test authorized Post/Page Live Preview and confirm anonymous requests cannot access drafts.
16. Smoke test the Posts index, Post detail, Page detail, and 404 paths.
17. Stop and restore the D1 backup plus prior Worker version if administrator access, existing content, SEO, public rendering, or draft isolation fails. Do not run `payload migrate:down` as a substitute for restoring a verified backup.

Do not publish the package, add Block Types, enable Page Templates, migrate production, or deploy as part of Stage 3.5 validation.
