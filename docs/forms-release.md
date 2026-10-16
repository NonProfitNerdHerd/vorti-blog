# Forms release

This release follows [the narrowed Forms scope](forms-release-scope.md). It does not add public account registration, user roles, a site-wide permission system, or reusable theme/template libraries.

## Using the builder

1. Open **Forms → Forms → Create New**. Edit the title directly in the page heading and add fields from the palette.
2. Select a field to edit its label, instructions, validation, choices and width. Drag fields or use their movement buttons. Undo/Redo preserves the working definition.
3. Use **Preview** to try the form without creating entries. Use **Logic** for conditions and calculations, and **Email** for notifications and **Actions** for other already-supported record actions.
4. **Save Draft** preserves changes without replacing the published form. **Publish changes** creates a new published revision. The public address is suggested from the title and can be edited in Form details.
5. Insert the **Form** block on a Page/Post, select the published form, and publish the page. The Publish tab also provides a standalone link, QR code and iframe embed.
6. Open **Forms → Entries** to review answers, attachments, workflow notes and notification status. Original answers and the field labels at submission time remain preserved.

## Form editor tabs

**Primary** contains the sole canvas builder, sharing tools and form metadata. The title stays editable in the page heading across tabs. **Email** contains notification recipients, messages, conditions and provider selection; it shares the same definition and undo history as Primary. **Analytics** contains activity and completion reporting. **Results** contains revision/date filters, a paginated table of entries, and the optional survey summary. Entry links open a separate tab to preserve the working form. Switching tabs retains unsaved values, selected fields and builder undo history; it does not publish the form.

**Import / Export**, the light-red main tab, transfers form definitions rather than entries. Import confirmation updates the same working definition as Primary and can be undone there. The builder toolbar keeps Build/Logic/Design/Actions/Access on the left and Undo/Redo, device previews, Try Form and Publish on the right. Publish opens readiness and sharing tools without immediately publishing.

New blank forms begin with a Section named **Group 1**. Select it to rename it or target it in Logic; palette additions remain inside the selected field’s group. Existing and imported definitions retain their structure. Empty existing forms offer **Add first group**. Hidden groups hide descendants; disabled groups keep descendants visible but disabled, with their answers excluded from validation and submission. No database migration is needed.

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
