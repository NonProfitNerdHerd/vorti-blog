# Block editor registration and release verification

The application always enables `contentWorkspace`. `CONTENT_WORKSPACE_ENABLED` is obsolete: its absence or value must not change the Payload field tree, admin component map, or template locks.

The 2026-10-12 regression came from generating the admin import map with the workspace disabled, then building/running with it enabled. Payload requested `ContentWorkspace` but its map could not resolve it. Public pages and the admin login route still worked, so public-only smoke checks did not catch the blank document editor.

`scripts/check-editor-registration.mjs` parses the generated map without evaluating client modules. It checks the workspace, both Template editors, header slots, Post Type values, Saved Views and Tasks registrations, including their imported aliases. Next configuration and the production deployment intent guard call this check. Missing entries fail with an instruction to regenerate instead of allowing a blank editor release.

Run these steps sequentially:

1. Rebuild `payload-design-core` if its source changed.
2. Generate the admin import map with `pnpm generate:importmap` using isolated local configuration. Do not run generation concurrently with a build.
3. Run `node --test scripts/check-editor-registration.test.mjs`, framework/application tests, lint and type checks.
4. Build the production OpenNext Worker. Do not rebuild or regenerate files while testing its bundle.
5. Run that bundle with `wrangler dev --config wrangler.test.jsonc --local --port 3104`, an isolated seeded D1 persistence directory, and a local-only Payload secret. The test state must contain the existing editor test fixtures. Never use production credentials or a production database for these tests.
6. Run `playwright test --config playwright.worker-editor.config.ts`. This suite restricts its target to localhost and exercises authenticated editing, header/panel behavior, Templates, Tasks, Event editing, Saved View selection, save/reload and publishing against the Worker bundle.
7. Deploy the same verified artifact with the existing production-intent guard, then verify public responses and authenticated live editing when an authorized session is available. A login-page or redirect check is not evidence that authenticated editors work.

The shared Saved View inspector now renders its document chooser independently of the hidden internal-style section. Placements still cannot change the view's internal query/design.

No migration, content reset, account change or dependency upgrade is part of this repair.
