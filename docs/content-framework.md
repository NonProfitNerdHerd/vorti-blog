# Post Types, Templates, and Saved Views

Post Types define structured content and allowed Templates. Posts stores all types in one collection; Pages remains separate. Adding a type through `/admin/collections/post-types` does not create a table. Only administrators change type definitions. Publish a definition before using it. Existing field identifiers and kinds are stable; add fields instead of repurposing stored values.

Templates define a full page. Resolution is the Post's explicit Template, the type default, then the built-in article/event presentation. Public type fields can be bound from the Template builder. A type change never happens as a side effect of changing presentation. Design permissions and server-side template locks still apply.

Saved Views define reusable queries and presentation. Create one at `/admin/collections/saved-views`, choose a layout and source, configure filters, and publish. Insert the Saved View block or rich-text embed, or declare a Saved View relationship field in a Template. Placements store a reference, not a copy; publishing the view changes every placement on subsequent requests. Each placement has independent search, filtering, page, and calendar state. Only outer width and spacing belong to the placement.

The block inserter also exposes all 36 built-in display layouts directly under **Events** and **Post displays** in Posts, Pages, content Templates, and Site Template Header/Footer editors. Search `events` or `postx`, or choose a named layout such as Month Calendar or Post Grid 7. Select the block and use its inspector to choose Post Types, categories/tags, matching rules, item count, and pagination, then select **Create view and use here**. This creates a published central Saved View and attaches its ID; it does not publish the document. Alternatively, select an existing Saved View. Template insertion retains its existing **Save Element** step.

After setup, use the inspector's **Saved Views** link for the full query and design builder. Named placements have the same outer-spacing-only restrictions, permissions, usage tracking, and published resolution as the generic Saved View block. Setup choices remain in the document's draft JSON until the view is created. Event queries always restrict results to event-capable types, even when the Post Types selector is empty. These are our shared renderers, not WordPress plugins or shortcode parsing.

`/framework-demo` links to all demonstration layouts. Demo records are clearly named; setup reuses existing media and never creates production credentials. No old sample deletion is required by this additive release. Tasks remain separate and unchanged.

## Capability and evidence matrix

| Capability                                     | Implementation and reproducible example                                                                                   | Boundaries                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Types and fields                               | `collections.ts`, `validation.ts`, `TypeValues.tsx`; create a type, add public/private fields, create a Post              | Registered field kinds; no arbitrary code or collection creation                                                                    |
| Templates and routes                           | `presentation.ts`, `plugin.ts`, `/[slug]/[item]`; Event links use `/events/slug` without a custom Template                | Type prefixes are validated and stable; no legacy redirects                                                                         |
| Reusable queries                               | `query.ts`, `ViewBuilder.tsx`; edit and publish a demo view, open its demo page                                           | One AND/OR rule group with per-rule Any/All/exclusion; 100 selected items and 30 rules                                              |
| Publication and permissions                    | `content-framework.int.spec.ts`; draft view edits do not change anonymous results; unpublished placements rejected        | Preview requires authentication; source access is rechecked after index lookup                                                      |
| Grid 1–7                                       | Shared `DynamicView.tsx` and `views.css`; `/demo-grid-1` through `/demo-grid-7`                                           | Distinct arrangements and treatments, not every PostX cosmetic preset                                                               |
| List 1–4                                       | `/demo-list-1` through `/demo-list-4`                                                                                     | Same shared public metadata and field toggles                                                                                       |
| Slider 1–2, Module 1–2                         | `/demo-slider-1`, `/demo-slider-2`, `/demo-module-1`, `/demo-module-2`                                                    | Manual navigation; no automatic motion                                                                                              |
| Taxonomy, search/filter, ticker                | `/demo-taxonomy`, `/demo-search`, `/demo-ticker`                                                                          | Ticker is a compact navigable treatment, not automatically scrolling text                                                           |
| Month/week/day/year/switchable calendars       | `/demo-event-month`, `week`, `day`, `year`, `calendar`; period navigation, timezone-aware cells, timed overlap lanes      | Calendar query windows limited to 366 days                                                                                          |
| Lists, agenda, grid, tiles, masonry, timetable | `/demo-event-list`, `agenda`, `grid`, `tiles`, `masonry`, `timetable`                                                     | CSS masonry treatment; browser layout determines column flow                                                                        |
| Map and event list                             | `/demo-event-map`; select a list entry to change the OSM location                                                         | One focused coordinate at a time; no clustering, geocoding, or multi-marker map                                                     |
| Slider/carousel/cover/countdown/widget/single  | `/demo-event-slider`, `carousel`, `cover`, `countdown`, `widget`, `single`                                                | Manual slides; countdown targets the returned upcoming occurrence                                                                   |
| Recurrence and exceptions                      | `schedule.ts`, `schedule.test.ts`; Event Schedule editor supports series changes and individual cancellation/rescheduling | Daily/weekly/monthly/yearly rules; invalid month dates skipped; bounded expansion of 10,000 occurrences and 200,000 historical days |
| Daylight saving                                | Explicit offset disambiguation for entered times; generated gaps move forward and folds use the first occurrence          | No external calendar synchronization                                                                                                |
| Styling and embeds                             | Shared Layout/Style/Advanced controls, responsive preview, Saved View blocks in all adapters, Lexical embed               | Internal styles edited centrally; converting a legacy listing starts with grid/list baseline settings                               |
| Icons                                          | `BlockGlyph.tsx`; shared SVG in inserter, outline, inspector, toolbar                                                     | Bundled validated paths; no arbitrary uploaded SVG                                                                                  |

Browser coverage is in `tests/e2e/content-views.e2e.spec.ts`: all 36 families at desktop/tablet/phone, dark mode and reduced motion, plus admin editing, paging, calendar navigation and dialogs. Existing workspace and Tasks browser tests cover shared editor integration. Integration coverage includes migration, anonymous denial, published projections, default Template locking, unsafe presentation, draft isolation and reference protection. Visual screenshots are local test artifacts, not a claim of identical reference-product styling.

## Registering extensions

Server code imports pure contracts from `@design-system/payload-design-core`. Browser components import `/content` or `/admin`; importing the root into a client module also imports Payload server dependencies.

Register metadata once using `registerContentSource`, `registerContentCapability`, `registerView`, and `registerBlockIcon`. Register before editors or validation run, with stable unique keys. New capabilities can declare required structured-field kinds. Persistence and access checks belong in the application's source adapter (`src/content-framework/query.ts`); a registry entry alone does not implement a new data source. Current query execution supports Posts and Pages.

```tsx
// Shared application registration, imported by both the editor and public renderer.
import { registerView } from '@design-system/payload-design-core/content'

registerView({
  key: 'compact-headlines',
  label: 'Compact headlines',
  family: 'posts',
  thumbnail: 'list',
  render: ({ result }) => (
    <ul>
      {result.items.map((item) => (
        <li key={item.id}>
          <a href={item.url}>{item.title}</a>
        </li>
      ))}
    </ul>
  ),
})
```

Register the corresponding pure metadata in server initialization when a renderer module requires browser-only dependencies. Keep keys identical. Custom renderers receive already projected public items and must retain accessible links and interaction semantics. Use `documentURL` for Post links instead of assembling prefixes. New layout families reuse Saved View placement and editor adapters; no per-editor registration is needed.

## Setup and release

Migration `20261012_040000_post_types_views` adds versioned Post Types/Saved Views, Posts type fields, relationships and the private event-series index. It seeds Post/Event and assigns existing Posts to Post. It preserves users, media, site settings, Tasks and existing documents.

`setupContentFramework(payload, administratorID, true)` adds repeatable named demonstrations, two Templates, 36 views and 37 Pages. It requires an existing administrator; it creates no user. It also associates its demonstration Templates with Post and assigns them to the first two demonstration Posts on rerun.

Before production migration, record a D1 Time Travel bookmark. Build the shared package, generate Payload types/import map, run tests/type/lint checks and build the production worker. Apply the ordered Payload migration with the existing production-intent guard, run setup, deploy the built worker, and verify admin/API/demo responses. Recovery is coordinated D1 Time Travel restoration and deployment of the matching previous Worker; the migration intentionally has no destructive automatic down operation.

Local browser suite uses `playwright.views.config.ts` and a seeded server on port 3102. Never point its local fixture credentials or test persistence paths at production.
