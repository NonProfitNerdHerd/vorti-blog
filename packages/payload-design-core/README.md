# Payload Design Core

Reusable Block Type, Block Design, Template, and content reference model for Payload 3.87. The package stores live IDs and content values, never copied design settings or executable code.

## Integration

```ts
designSystemPlugin({
  blockCreator: true,
  templates: true,
  templatableCollections: ['articles'],
  canManage: ({ req }) => ['administrator', 'designer'].includes(req.user?.role ?? ''),
  isDesignManager: (user) => ['administrator', 'designer'].includes((user as { role?: string })?.role ?? ''),
  blockPacks: [heroBoardRegistration],
})
```

The consuming app chooses its own collection slugs, role field, account backfill, migrations, renderer registry, and cache invalidation. This package does not change user roles. In Vorti Blog, `Users.role` supports `administrator`, `designer`, and `editor`; new users default to editor. Its Stage 2 migration grants administrator only to the email named by `DESIGN_ADMIN_EMAIL`. Set that environment value before migrating a database with existing users; review the selected account afterward. Other apps should implement their own explicit role policy.

Design navigation contains Block Creator and Templates. Block Designs have `admin.group: false`, which removes their link while retaining the collection edit route. Block Creator's join field links directly to those edit routes. Payload's `admin.hidden` would also remove routing and is therefore not used for managers.

## Template workflow

Templates are Payload draft/version documents. The structured sections array supports add, remove, and reorder; each row has a stable key, label, Block Type, default Block Design, required flag, and editor override flag. The Design selector filters to published Designs of the selected Block Type. Server hooks also reject mismatches and duplicate or invalid keys. The Standard Article seed contains one required Hero Board section; future areas are added through the same structure.

Configured content collections gain `designTemplate`, `templateValues`, and `designOverrides`. The Admin content editor presents Template fields and published Design choices. A null or absent override follows the current published Template default. An explicit override pins only the Design ID; publishing new settings on that Design still flows through. Media values are IDs stored on content and resolved by the consuming frontend. The editor cannot change global presentation settings.

Published rendering uses the published Template and Designs. Post draft preview uses the current Post draft values with those published global records. Publishing a Template draft changes what linked content resolves without rewriting content. Adding a required section leaves existing content renderable with empty values; the editor warns about missing required fields and a subsequent content update must fill them. Removing a section suppresses its output while retaining its `templateValues` and override entry. Readding the same stable key restores those values. Audit orphaned values before any future cleanup migration; no automatic purge runs.

The Template panel reports linked content counts. The Block Design panel reports linked Templates and affected content. Deleting or archiving referenced published records is guarded.

## Distribution

`pnpm --filter @design-system/payload-design-core build` compiles JavaScript and declarations to `dist`, copies CSS, and fixes relative ESM imports for Node. Exports point to the compiled files; the package tarball whitelists `dist`. Payload, `@payloadcms/ui`, and React are peer dependencies. `pnpm --filter @design-system/payload-design-core test` runs the unit suite. `pnpm pack --pack-destination /tmp` verifies package contents without publishing. The package remains private pending review.

## Local Vorti Blog test

Use a native Linux checkout with Node 22.16 and pnpm 10.28. Build the package before the app. Run `pnpm payload migrate` only against a fresh local D1 state. The application can set `DESIGN_CORE_TEST_PERSIST_PATH` to an isolated local Wrangler state directory; it also disables dev schema push so migration tests use the actual migration schema. Then run package typecheck/tests, application typecheck/integration tests, Playwright tests, `pnpm build`, and `pnpm exec opennextjs-cloudflare build`.

In Admin, open Design → Templates → Standard Article. Its Hero section references Hero Board and Hero Board - Feature. Open a Post, choose Standard Article, enter Hero content, save/publish, and visit `/posts/<slug>`. Change the Template's default Hero Design and publish to observe inherited Posts update. Set an explicit Post Hero override to observe the override remain selected when the Template default changes. Use Live Preview to inspect unsaved Post values.

The custom Template editor is mounted on its `templateValues` JSON field and uses Payload `useField` for both content and Design overrides. Its controls respect Payload's form-processing state so an in-flight save cannot overwrite a subsequent edit. The browser regression covers repeated saves on one mounted Post form and checks persisted Payload data.
