# Forms release

This release follows [the narrowed Forms scope](forms-release-scope.md). It does not add public account registration, user roles, a site-wide permission system, or reusable theme/template libraries.

## Using the builder

1. Open **Forms → Forms → Create New**. Enter a title and add fields from the palette.
2. Select a field to edit its label, instructions, validation, choices and width. Drag fields or use their movement buttons. Undo/Redo preserves the working definition.
3. Use **Preview** to try the form without creating entries. Use **Logic** for conditions and calculations, and **Actions** for notifications and already-supported record actions.
4. **Save Draft** preserves changes without replacing the published form. **Publish changes** creates a new published revision. The public address is suggested from the title and can be edited in Form details.
5. Insert the **Form** block on a Page/Post, select the published form, and publish the page. The Publish tab also provides a standalone link, QR code and iframe embed.
6. Open **Forms → Entries** to review answers, attachments, workflow notes and notification status. Original answers and the field labels at submission time remain preserved.

## Form editor tabs

**Primary** contains the title, builder, sharing tools and form details. **Analytics** contains activity and completion reporting. **Results** contains revision/date filters, a paginated table of entries, and the optional survey summary. Entry links open a separate tab to preserve the working form. Switching tabs retains unsaved values, selected fields and builder undo history; it does not publish the form.

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
