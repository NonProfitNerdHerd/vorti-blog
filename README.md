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
- A personalized Dashboard with publishing summaries, personal tasks, accessible projects, and recent/favorite boards.

Capabilities depend on configuration and permissions. See the application and tests for the behavior supported by each module.

## Where we are going

VortiCause is growing into an integrated platform for public websites and organizational work. Planned areas include donor CRM and fundraising workflows inspired by tools such as CiviCRM and Kindful, broader automation packages, and intranet/extranet experiences. These are roadmap goals, not claims that complete CRM or portal products ship today.

Open source and easy hosting are central goals. The current deployment targets Cloudflare; simpler installation, clearer operational tooling, and more hosting options are ongoing work.

## Development setup

Clone [this repository](https://github.com/NonProfitNerdHerd/vorti-blog), install a supported Node.js version from `package.json` (Node 22 is used for release verification), and enable Corepack:

```sh
corepack enable
pnpm install
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

New installations should create their initial administrator, apply the tracked migrations with that account identified by `DESIGN_ADMIN_EMAIL`, and configure their own identity in Admin → Settings. The guarded content-framework setup script can initialize the default content types; demonstration content is optional. See `scripts/setup-content-framework.ts` for its required configuration.

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

Database integration suites need isolated persistence. Use a separate local database per schema-pushing process. Generate types and component imports after changing schemas or registered admin components:

```sh
pnpm generate:types
pnpm generate:importmap
```

## Cloudflare hosting and releases

The supported production target uses a Paid Workers plan for the current bundle, D1 for data, and two R2 buckets: `R2` for public media and `WORKSPACE_FILES` for protected workspace uploads. Private workspace files must remain outside public bucket routes. Check [Cloudflare's current limits](https://developers.cloudflare.com/workers/platform/limits/) when choosing a plan.

Configure bindings and resource identifiers for your own deployment; do not deploy a clone against this repository's production IDs. Configure `PAYLOAD_SECRET` as a Worker secret, preserve the `forms-worker.ts` entry point, and retain the scheduled trigger required by Forms processing. The OpenNext build supplies `.open-next/assets`.

For a production release:

1. Run appropriate tests, lint, typechecks, affected package builds, and the production build/dry-run. Commit and push the reviewed source.
2. Record the active Worker version and a [D1 Time Travel recovery bookmark](https://developers.cloudflare.com/d1/reference/time-travel/).
3. Review and apply pending tracked migrations. Production migration commands require `DESIGN_PRODUCTION_MIGRATE=YES` and `DESIGN_ADMIN_EMAIL`; releases without schema changes do not need a migration.
4. Deploy with `DESIGN_PRODUCTION_DEPLOY=YES pnpm deploy:app`. To deploy an already tested OpenNext artifact, use `DESIGN_PRODUCTION_DEPLOY=YES pnpm exec opennextjs-cloudflare deploy` after the repository's deployment-intent check.
5. Verify the live build ID, public/admin routes, asset delivery, and role-specific behavior. Remove temporary verification records and confirm historical data is intact.

Cloudflare resource names and deployed URLs can differ from the VortiCause product name. Renaming the product does not rename existing Workers, databases, buckets, or authentication cookies.

`ORGANIZATION_ADMIN_ENABLED=true` registers the authenticated Sites administration screen at `/admin/sites` and its services. Keep it false for installations that have not completed the organization/CRM migrations and access checks. This setting does not grant account permissions. Non-default sites have private identity settings (name, tagline, timezone); existing public URLs and full public Site Settings continue to belong to the compatibility site. Public subsite routing remains unfinished.

Production logging uses the application's JSON console logger. `PAYLOAD_LOG_LEVEL` controls verbosity. Worker observability and any mail/analytics provider connections require their own configuration.

## Contributing

Use repository issues and pull requests for defects and proposals. Keep feature documentation honest about implemented behavior, preserve user data and access boundaries, and add meaningful verification for behavioral changes. Easier setup and hosting are welcome areas for contributions.
