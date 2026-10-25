# VortiCause

**An open-source, headless content management and collaboration platform with a WordPress-like authoring experience.**

VortiCause brings publishing and the work behind it into one platform. Authors get a visual editor, familiar content management, and reusable templates. Developers get structured content and APIs for headless delivery. Organizations get projects, boards, tasks, forms, and event calendars alongside their website.

## Available today

- Posts, pages, reusable content types, visual block editing, templates, responsive design, drafts, previews, and publishing controls.
- Site identity, reading, privacy, typography, categories, and role-based tag settings.
- Reusable named menus with a visual hierarchy editor and independently styled Menu blocks across visual builders.
- Projects and boards with List, Kanban, Calendar, Timeline, and additional workspace views; shared tasks, subtasks, comments, mentions, and an in-app Inbox.
- Private/team-wide collaboration, inherited project permissions, private-board exceptions, protected attachments, time tracking, and audited time corrections.
- Event content with timezone-aware schedules, recurrence, and calendar/listing presentations. Events remain part of the existing content-type system.
- Forms, submissions, embedding, and workflow/automation foundations.
- Staff donor CRM: constituents and relationships, households, gifts and split allocations, campaigns/funds/appeals, pledges and recurring reconciliation, memberships, opportunities, volunteers, receipts/correspondence, reviewed imports, and linked follow-up Tasks.
- Chapter-aware organization administration and SubSites, with scoped access and public site routing.
- A personalized Dashboard with publishing summaries, personal tasks, accessible projects, and recent/favorite boards.

Capabilities depend on configuration and permissions. See the application and tests for the behavior supported by each module.

## Where we are going

VortiCause is growing into an integrated platform for public websites and organizational work. The staff CRM is available, but controlled constituent merges remain disabled. Saved reports with complete exports and opportunity Boards integration remain unfinished. Broader automation and intranet/extranet experiences are roadmap goals. Recurring giving reconciles recorded payments; it does not charge donors. Live correspondence remains disabled until provider and sender configuration is validated. Preview, print and PDF workflows do not require email configuration.

Open source and easy hosting are central goals. The current deployment targets Cloudflare; simpler installation, clearer operational tooling, and more hosting options are ongoing work.

## Development setup

Clone [this repository](https://github.com/NonProfitNerdHerd/vorti-blog), use the verified release toolchain: Node 22.23.2, pnpm 10.28.2, and the lockfile-pinned Wrangler 4.152.0, and enable Corepack:

```sh
corepack enable
pnpm install --frozen-lockfile
```

Copy `.env.example` to a local `.env` and configure a strong `PAYLOAD_SECRET`. Keep secrets out of source control. Set `NEXT_PUBLIC_SITE_URL` to your site's public origin. Set `CONTENT_WORKSPACE_ENABLED=true` to enable the visual post/page editor.

Build the shared design package when working from source:

```sh
pnpm --filter @design-system/payload-design-core build
```

The checked-in `wrangler.jsonc` identifies the existing production resources. For local work, use isolated bindings and persistence rather than these remote resources. The test configurations and seed helpers provide isolated examples:

```sh
pnpm exec playwright test --config playwright.workspace.config.ts
pnpm test:editor
```

The workspace browser suite seeds its own local database. The editor suite uses `wrangler.test.jsonc`. Set `PLAYWRIGHT_CHANNEL=msedge` if you use Edge instead of Chrome. To run development against a prepared isolated database, set `DESIGN_CORE_TEST_PERSIST_PATH` to that database's persistence directory before `pnpm dev`; this disables automatic schema pushing for that prepared database.

New installations must execute the complete registered migration chain against an empty isolated database; never substitute a populated database or manually mark migrations applied. Seed required platform defaults and establish the initial installation operator and site administrator through the supported setup services. Production migration commands require `DESIGN_ADMIN_EMAIL`. Configure installation identity in Admin → Settings. The guarded content-framework setup script can initialize the default content types; demonstration content is optional. See `scripts/setup-content-framework.ts` for its required configuration.

## Architecture and licensing

The application uses Next.js, React, a shared design package, and Payload's underlying content/authentication APIs. VortiCause owns its product experience and application modules. Dependency package names, framework configuration keys, and generated technical identifiers retain their compatibility names; they are not customer-facing product branding.

The root package declares the MIT license. Third-party dependencies retain their own licenses and notices, including notices bundled with the Forms runtime.

Customer site titles, logos, and icons are separate from VortiCause's admin identity. Product branding changes do not overwrite those saved settings.

## Testing and builds

```sh
pnpm exec tsc --noEmit
pnpm lint
pnpm test:int
pnpm exec playwright test --config playwright.workspace.config.ts
pnpm test:editor
pnpm build
```

The integration command runs separate Node, DOM and native Payload/D1 Vitest projects, including native Task authorization and the CRM Task bridge. Native suites execute the full migration chain into a clean baseline and receive separate disposable databases. The checkpoint release browser configuration runs 25 scenarios: 16 CRM workflows and nine CMS/Forms/Tasks/SubSites regressions.

```sh
# Requires the final local Worker URL and isolated tenant/Forms fixtures.
# CRM_WORKER_BASE_URL, TENANT_HTTP_FIXTURE, FORM_TEST_ADMIN_FILE
pnpm exec playwright test --config playwright.checkpoint.config.ts
```

Database integration suites need isolated persistence. Use a separate local database per schema-pushing process. Generate types and component imports after changing schemas or registered admin components:

```sh
pnpm generate:types
pnpm generate:importmap
```

## Cloudflare hosting and releases

The supported production target uses a Paid Workers plan for the current bundle, D1 for data, a configured CRM Queue (`CRM_JOB_QUEUE`, with producer and consumer), and two R2 buckets: `R2` for public media and `WORKSPACE_FILES` for protected workspace uploads. Private workspace files must remain outside public bucket routes. Check [Cloudflare's current limits](https://developers.cloudflare.com/workers/platform/limits/) when choosing a plan.

Configure bindings and resource identifiers for your own deployment; do not deploy a clone against this repository's production IDs. Configure `PAYLOAD_SECRET` as a Worker secret, preserve the `forms-worker.ts` entry point, and retain the scheduled trigger required by Forms processing. The OpenNext build supplies `.open-next/assets`.

For a production release:

1. Start from a clean checkout on `main`. Run TypeScript, lint with zero errors, and all integration projects. Commit and push the reviewed source. Build the optimized Worker from that immutable commit, record input/artifact checksums, and pass the deployment dry-run. Run the complete release browser suite against that exact artifact.
2. Record the active Worker version and a [D1 Time Travel recovery bookmark](https://developers.cloudflare.com/d1/reference/time-travel/).
3. Review and apply pending tracked migrations. Production migration commands require `DESIGN_PRODUCTION_MIGRATE=YES` and `DESIGN_ADMIN_EMAIL`; releases without schema changes do not need a migration.
4. Run `DESIGN_PRODUCTION_DEPLOY=YES node scripts/require-production-intent.mjs deployment`, then deploy the retained artifact with `pnpm exec wrangler deploy --config /absolute/path/to/production-config.json`. That reviewed configuration must reference the frozen Worker/assets with `no_bundle: true`, retain the production bindings and preserve existing secrets. The convenience `pnpm deploy:app` command builds again, so do not use it to publish an artifact already accepted by browser tests.
5. Deploy the tested artifact without rebuilding. Verify public/admin routes, assets, anonymous denials and authenticated CRM/CMS/Forms/Tasks access using read-only production checks. Monitor requests and exceptions for ten minutes. Recovery restores the previous Worker and its matching bindings together. Keep production donor data and live correspondence out of test fixtures.

Cloudflare resource names and deployed URLs can differ from the VortiCause product name. Renaming the product does not rename existing Workers, databases, buckets, or authentication cookies.

`ORGANIZATION_ADMIN_ENABLED=true` registers the authenticated Sites administration screen at `/admin/sites` and its services. Keep it false for installations that have not completed the organization/CRM migrations and access checks. This setting does not grant account permissions. Site identity, public routing, content and administration are scoped to the selected site. Public SubSites routing and isolation are supported; verify site-specific behavior when changing routing or publication.

Production logging uses the application's JSON console logger. `PAYLOAD_LOG_LEVEL` controls verbosity. Worker observability and any mail/analytics provider connections require their own configuration.

## Contributing

Use repository issues and pull requests for defects and proposals. Keep feature documentation honest about implemented behavior, preserve user data and access boundaries, and add meaningful verification for behavioral changes. Easier setup and hosting are welcome areas for contributions.
