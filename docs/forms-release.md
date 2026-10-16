# Forms release

## Forms Build sidebar layout

The Build workspace aligns directly with the main tab divider. The desktop List View / Add Parts sidebar is 244px wide, and the inspector remains 320px. Both panels use the page's scrolling flow instead of sticky, independently scrolling regions. The left background stretches through the workspace height; long part lists or settings extend the page naturally.

The workspace minimum height is measured from its document position to the viewport bottom and refreshed when headers, tabs, or viewport dimensions change. Scrolling does not increase that minimum. Other Forms tabs retain their existing spacing, and mobile drawers retain their bounded scrolling and focus behavior. No stored form data or database schema changes are involved.

Sidebar verification (2026-10-16): 193 framework tests, focused lint, production TypeScript compilation, 22 editor registrations, and the Worker build passed. Five authenticated browser scenarios passed against the local production bundle, covering geometry and page scrolling, mobile focus/overflow, tab state, named canvas editing/publication, and drag/cancel/undo. Desktop and mobile dark-mode layouts were reviewed. Authenticated live editing remains unavailable; live checks cover responses and deployed assets.

## Named canvases and part navigation

Build now opens a **List View** showing named canvases and their nested parts. **Add Parts** contains only the existing Forms palette, plus Canvas (the existing Step structure with an author-facing name). The header **+** opens a searchable part picker; the adjacent list button toggles the sidebar. Mobile uses a dismissible drawer.

New forms start with **Canvas 1**. Select a canvas to rename it and edit its contents. Palette clicks insert inside a selected container or after a selected ordinary part. List View selection reveals the owning canvas; only that canvas is shown in the editing area. Canvas switching does not change stored data or create an undo entry.

Use row actions to rename, duplicate, reorder, move a part to another canvas, or delete. Dragging also supports cross-canvas movement and cancellation. Canvases stay at the top level. Duplicates receive fresh IDs using the existing reference-aware duplication helper. Deletion requires confirmation and is blocked when retained rules, actions, calculations, or other settings still reference the removed parts. Undo/redo includes these structural changes.

Older flat forms appear under a virtual Canvas 1 without changing their stored structure. **Add Canvas** offers an explicit, undoable organization step: wrap existing parts in Canvas 1 and create Canvas 2. Existing field IDs and settings remain intact. Empty existing forms offer **Add first Canvas**. Mixed or nested legacy Steps show a repair explanation instead of automatic conversion. Imported structures are preserved.

Canvas is stored as `kind: 'step'` in the existing definition JSON. Public display mode remains unchanged: standard forms retain their normal rendering, and existing multi-step behavior remains available. This release builds the authoring structure; it does not introduce conditional A-to-B/C pathway execution. No database migration or content deletion is needed.

Framework consumers may supply `navigationTarget` for the header insertion/list controls. Standalone consumers retain inline controls. Email, transfer, device settings, selected parts, and history remain owned by the same mounted builder.

Canvas verification (2026-10-16): 193 framework tests, 61 Forms integration tests, lint (zero errors; existing warnings), TypeScript compilation, the 22-component registration guard, and the production Worker build passed. Eleven authenticated scenarios passed against the local production bundle with isolated storage: tabs/results, creation/publication/submission, empty-form opt-in, transfer/history, nested duplication/dragging, title/Email, legacy safeguards, Details/preview, named canvases, reference-safe deletion, and cross-canvas drag/cancel/undo. Desktop and mobile dark-mode screenshots were reviewed. Authenticated live editing was unavailable; deployment checks cover live responses and anonymous access denial.

This release follows [the narrowed Forms scope](forms-release-scope.md). It does not add public account registration, user roles, a site-wide permission system, or reusable theme/template libraries.

## Using the builder

1. Open **Forms â†’ Forms â†’ Create New**. Edit the title directly in the page heading and add fields from the palette.
2. Select a field to edit its label, instructions, validation, choices and width. Drag fields or use their movement buttons. Undo/Redo preserves the working definition.
3. Use **Preview** to try the form without creating entries. Use **Logic** for conditions and calculations, and **Email** for notifications and **Actions** for other already-supported record actions.
4. **Save Draft** preserves changes without replacing the published form. **Publish changes** creates a new published revision. The public address is suggested from the title and can be edited in Form details.
5. Insert the **Form** block on a Page/Post, select the published form, and publish the page. The Publish tab also provides a standalone link, QR code and iframe embed.
6. Open **Forms â†’ Entries** to review answers, attachments, workflow notes and notification status. Original answers and the field labels at submission time remain preserved.

## Form editor tabs

**Primary** contains the sole canvas builder, sharing tools and form metadata. The title stays editable in the page heading across tabs. **Email** contains notification recipients, messages, conditions and provider selection; it shares the same definition and undo history as Primary. **Analytics** contains activity and completion reporting. **Results** contains revision/date filters, a paginated table of entries, and the optional survey summary. Entry links open a separate tab to preserve the working form. Switching tabs retains unsaved values, selected fields and builder undo history; it does not publish the form.

**Import / Export**, the light-red main tab, transfers form definitions rather than entries. Import confirmation updates the same working definition as Primary and can be undone there. The builder toolbar keeps Build/Logic/Design/Actions/Access on the left and Undo/Redo, device previews, Try Form and Publish on the right. Publish opens readiness and sharing tools without immediately publishing.

New blank forms begin with a Section named **Group 1**. Select it to rename it or target it in Logic; palette additions remain inside the selected fieldâ€™s group. Existing and imported definitions retain their structure. Empty existing forms offer **Add first group**. Hidden groups hide descendants; disabled groups keep descendants visible but disabled, with their answers excluded from validation and submission. No database migration is needed.

Use **Export entries** in Results to choose CSV or Excel, dates and answer columns. Exports use their explicitly selected date range across all revisions, independently of the report filters. Export progress remains available when switching tabs or hiding its settings. Existing entry and export permissions still apply. The layout uses unnamed Payload containers and UI-only report fields; stored form paths and database schema are unchanged.

The tab update passed 57 Forms integration tests and five development-browser scenarios covering state retention, keyboard tab navigation, form creation/publication, survey results, analytics and Excel export. Two additional authenticated scenarios passed against the production Worker bundle with isolated local storage. TypeScript, focused lint, the 21-component registration guard and the production Worker build passed. No production data changes are required.

## Capability and configuration status

| Area | Release behavior |
| --- | --- |
| Visual fields and layout | Palette, selected-field settings, drag/keyboard arrangement, nested fields, duplication, undo/redo and responsive preview |
| Validation and logic | Shared client/server definition and answer validation; required fields, conditions and server-evaluated calculations |
| Saving and publication | Native Payload draft/publication lifecycle; published snapshots remain unchanged by draft edits |
| Placement | Shared Form block, standalone public page, QR and restricted-origin iframe; separate state for each placement |
| Submissions | Durable, idempotent acceptance; existing CMS roles protect entries and sensitive values |
| Notifications | Provider selection, escaped templates, durable jobs, automatic temporary-failure retries and manual recovery from entry details |
| Live email | Requires a configured Payload email adapter and verified sender. No email provider or sending domain was configured at release preparation. Unconfigured actions are visible and are never reported as delivered |
| Retained extras | Progress/resume, private uploads, basic booking resources, analytics, survey summaries, CSV/XLSX exports, printable receipts, JSON transfer and approved CMS record actions |
| Payments | Existing Stripe **test-mode** adapter; local simulator only in isolated development. No live payments or real Stripe account transaction is claimed |
| Not included | Account creation, reusable theme/template libraries, Turnstile setup, new provider accounts, production payment enablement or broader site-permission changes |

## Operation and recovery

`forms-worker.ts` retains OpenNext's fetch handler and calls the bounded Forms processor every five minutes. Set the random `FORM_JOB_TOKEN` Worker secret before deployment. The processor claims jobs with leases, applies bounded backoff, records attempts and cleans expired temporary Forms resources. It does not delete ordinary content.

Local development may capture messages without sending them. Production never uses local capture. After configuring a real provider, retry an unconfigured email from its entry. Provider failures do not discard the saved submission. Mail delivery is at-least-once; the stable message identity assists providers, but provider-level duplicate suppression depends on the adapter.

Three additive migrations extend the original Forms tables and add the completed Forms ledgers. Existing users, content, media, settings and review history remain intact. Record a D1 recovery bookmark before applying them. Automatic destructive down-migrations are intentionally unavailable.

The historical [implementation ledger](forms-implementation.md) records prior experiments and the superseded larger brief; its unfinished items are not part of this release commitment.

## Release verification

Workspace refinement (2026-10-16): 185 framework tests passed across the full run and isolated retries of two timing-sensitive editor suites; 57 Forms integration tests, type checks, lint (existing warnings only), the 21-registration guard, and the production Worker build passed. Six authenticated browser scenarios passed against the local production bundle: main tabs/results, new Group 1, existing-empty opt-in and nested insertion, definition transfer and history, nested duplication/drag/save/reload, and published sharing/QR/iframe. Desktop and mobile dark-mode layouts were reviewed. Live authenticated editing was unavailable; production checks cover public responses and protected-route behavior. No migration is required for this refinement.

Passed: 181 shared framework tests, 57 Forms integration tests, all 15 development-browser scenarios, application type checks, lint (warnings only), and the 18-component registration guard. The final production Worker build passed four additional authenticated editor/placement browser scenarios against copied local D1/R2 storage. Its scheduled processor returned 200; production-mode checks confirmed private entries and disabled local email capture. External provider delivery remains unverified until a provider is configured.

## Legacy forms and unified editing

The lower Form details section no longer exposes legacy field or email editors. Saved legacy fields are projected into the upper canvas, including supported IDs, widths, options, defaults and validation. Older notifications appear in Email, including when a form already uses a modern canvas definition. Opening a form does not persist conversion or change its published revision. A normal save records the working definition; original plugin fields and emails are retained.

Unsupported settings (including custom field types, sender/CC/BCC, rich-text formatting and unmatched placeholders) are listed for review. Primary requires acknowledgment of those differences before conversion can save, and the server enforces this for direct API requests too. Acknowledgment means the author has reviewed/recreated the differences; it does not enable unsupported settings. Email delivery still requires a configured provider. Review notes remain private and are excluded from public responses and portable exports. No database migration is needed.

Unified builder verification (2026-10-16): 187 framework tests, 61 Forms integration tests, lint, production TypeScript compilation, the 22-component registration guard and the Worker build passed. Five authenticated browser scenarios passed against the production bundle with isolated local storage, covering main tabs/results, creation/publication/submission, import/export/history, inline title validation and Email persistence, and legacy conversion/API review enforcement. Desktop and mobile dark-mode layouts were reviewed. Authenticated live verification remains unavailable; live checks verify public responses and protected routes.

## Consolidated Forms workspace

The main navigation is Build, Logic, Design, Actions, Access, Email, Details, Analytics, Results, and Import / Export. Build replaces Primary. Details contains the original metadata controls directly, with unchanged field paths. There is one canvas and no nested builder tab row.

Undo/Redo, device selectors, Try form, and Publish use the existing document-scoped header portal before Payload's native actions. Publish opens readiness and sharing; it does not publish immediately. Try form returns to the previously selected workspace tab. One mounted builder owns the definition, selection, and history throughout tab changes. Metadata continues using Payload's normal form state and native save actions.

Standalone framework consumers retain internal navigation and toolbar defaults. Integrated consumers can supply `navigation: { view, onChange }` and an optional `toolbarTarget`; email and transfer continue using the same working definition. No schema changes, migration, data deletion, or email-provider configuration is included.

Consolidated workspace verification (2026-10-16): 188 framework tests and 61 Forms integration tests passed. Lint, production TypeScript compilation, the 22-component registration guard, and the release Worker build passed. Six authenticated browser scenarios passed against the final local production bundle, covering tab navigation and exports, creation/publication/submission, transfer/history, inline title and Email persistence, legacy conversion protections, and Details save/reload with shared history and preview return. The regression suite asserts desktop toolbar alignment beside native Publish changes; desktop and mobile dark-mode screenshots were reviewed. No migration is required. Authenticated live editing remains unverified unless an existing live session becomes available.

## Forms parts and Columns

All Forms palettes, insertion pickers, List View rows, and inspector headings use bundled SVG icons. Matching Paragraph, Heading, Columns, and Divider icons reuse the shared artwork without registering Posts/Pages blocks. Search hides empty categories. The canvas displays authored labels and content without permanent editor-name bars or drag handles; use List View for drag movement and contextual actions. Canvas previews select parts rather than collect responses; Try form remains interactive.

New Columns use existing `row` and `section` kinds with optional `layout` metadata: the row has `{ kind: 'columns', width: 'inherit' | 'content' | 'full' }`, and each section has `{ kind: 'column', weight: number }`. The initial row has two equal columns. Eleven visual presets are available on insertion and in the inspector. Preset changes retain surviving container IDs and all nested fields; shrinking appends removed columns' children to the last retained column in order. Referenced column containers cannot be removed by a preset change. Existing rows without metadata retain their prior rendering until a layout is explicitly selected.

Content Width is centered and capped at 1100px. Full Page is restricted to canvas-level Columns, reaches browser edges in public placements or the iframe viewport in embeds, and stays within the simulated viewport in the builder. Phone layouts stack in authored order. Insertion buttons remember their parent and sibling position; cancelling does not mutate the definition. These changes need no migration and do not add conditional routing.

Parts/Columns verification (2026-10-16): 198 framework tests passed across the full run and serial retries of two timing-sensitive editor suites; the final Forms-only run passed 57 tests. All 61 Forms integration tests, application type checks, lint (one existing image warning), the 22-component registration guard, and the production Worker build passed. Fourteen authenticated browser scenarios passed against the final production bundle with isolated storage, including all eleven column presets, contextual insertion/cancellation, inspector updates, List View selection and dragging, duplication, undo/redo, import, save/reload/publication, and standalone/page/iframe edge-to-edge rendering with phone stacking. Desktop and mobile dark-mode screenshots were reviewed. A prior test targeting the removed group title bar was updated to select through List View. Live authenticated editing was unavailable; no migration or production content reset is required.

## Contact parts, internal labels, and expanded settings

Forms now separates the internal `blockLabel` from the respondent-facing `label`. Existing parts fall back to their original label; their first question edit captures that label as the internal name. Duplicates keep the question and receive an internal “copy” name. Labels used by submission validation, reports, and notifications remain respondent-facing.

The sidebar has separate Add parts and Add Canvas buttons. All insertion dialogs are centered with three columns at desktop widths (40vw maximum), two below 900px, and one below 480px. Expand settings and double-click use one shared settings implementation with General, Choices, and Default answer tabs as applicable. Edits immediately join the working draft and undo history; closing never saves or publishes.

Optional definition metadata uses existing JSON storage:

- `widthFraction`: 0.1–1 in 0.01 increments; old `width` grid spans remain supported.
- `contact.format`: Name `full`, `firstLast`, `middleInitial`, or `middle`; Phone/Address `us` or `international`. Absence preserves legacy behavior.
- `contact.line2`: enables the optional US address second line.
- `components`: fixed component keys with optional label, help, placeholder, and widthFraction. Components remain one answer under their parent ID, not movable parts or independent rule targets.

Build, preview, and public rendering share contact input components. New Names use first/last inputs; middle initials accept a Unicode letter and optional period. New Phones use +1 and three US number segments, support complete-number paste, and normalize valid US submissions to +1 followed by ten digits. International phones retain a country calling code and national-number string. New Addresses use Address, City, State, and ZIP with 100/50/20/30 percent defaults, a US state/territory selector, and ZIP+4 support. International addresses retain flexible region/postal fields. Original submissions and published snapshots are not converted. Changing a format does not discard defaults: hidden configured values produce a correction issue.

Selected fields/components have pointer and keyboard resize handles. Width accepts fractions or percentages; dragging commits one undo step, Escape cancels, siblings retain their widths and wrap, and phone layouts stack. Ranking uses mouse/touch drag handles and Space/arrow-key pickup, movement, drop, and Escape cancellation while retaining explicit confirmation.

No database migration, content deletion, external address/phone verification, or new routing is included. US phone validation checks format, not whether a number is assigned; address validation does not establish deliverability. Original answer keys remain unchanged, with `full` and `middle` added only for explicitly configured Name layouts.

Contact/settings verification (2026-10-16): the full framework run passed 204 tests; the final Forms run passed 64 tests, including added label-preservation and width-error recovery coverage. All 61 Forms integration tests passed. Sixteen authenticated browser scenarios passed against the final production Worker with isolated storage; the contact scenario was additionally expanded and passed with all four Name layouts, US/international/legacy Phone formats, US/international Address formats, direct API validation, and mouse/touch/keyboard ranking. Browser checks also cover pointer/keyboard resizing with cancellation and undo, modal focus, save/reload/publication, mobile/dark mode, imports, legacy conversion, and existing Columns/canvas behavior. Desktop picker/settings and mobile screenshots were reviewed. Type checks, registration guard (22 components), production Worker/embedded-runtime build, and lint passed with the existing image-optimization warning. No authenticated production browser session is available; live verification is limited to public/admin/API responses and generated assets.
