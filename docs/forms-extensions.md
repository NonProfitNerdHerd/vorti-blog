# Forms extension boundaries

This describes the implemented extension points. It is not a claim that the complete Forms brief is finished; see [the implementation ledger](forms-implementation.md) for remaining work.

## Shared definitions and rendering

Import server-safe contracts from `@design-system/payload-design-core/forms`. Import React controls from `@design-system/payload-design-core/forms/client`. Do not import application secrets, Payload persistence, or D1 adapters into the shared client package.

`formFields.register` accepts a `FieldRegistration`: stable `kind`, label, category, description, validation, and export formatting. Optional flags identify numeric, structural, and choice fields. Registrations reject duplicate kinds so extensions cannot silently replace the meaning of saved definitions. Register the same semantics on both server and client.

`registerFieldRenderer(kind, Component)` supplies the React input. Its `FieldInputProps` include the stable input ID, current structured value, `onChange`, disabled state, error state, and description IDs. Forward these accessibility attributes to the actual input. Labels belong to the common renderer. Emit values through `onChange`; never write answers to local storage or mutate the published definition.

Custom inputs must be tested through `definitionShapeIssues`, `validateDefinition`, `evaluateForm`, `validateAnswers`, rendering, and export formatting. A palette entry alone is not a completed field. Extend the supported definition shape explicitly if a field needs additional configuration. Retain field and option IDs when labels or order change.

## Actions and integrations

`formActions.register` supplies the visual action name, help, typed settings, and configuration validation. `ActionHandlers.register` supplies the server executor. Register real executors in the application adapter; a visual action with no executor remains unconfigured.

Executors receive `ActionContext` with the durable job and its accepted action configuration. Resolve submission and integration records using the job's site. Never accept an arbitrary collection, privileged field, recipient, or secret directly from a public request. Entries are durable before dispatch. Use the stable job event ID as the external idempotency key, and account for at-least-once delivery after interrupted requests.

Throw `UnconfiguredAction` when a provider is not configured and `PermanentActionError` for a non-retryable configuration failure. Transient failures use bounded queue retries. Do not log credentials, submitted answers, or private resume/payment tokens. The existing webhook transport validates HTTPS destinations, rejects private DNS results, prevents redirects, signs the exact body, and uses a timeout; new HTTP integrations must preserve that boundary.

`FormPlatform` is the application boundary for D1, private R2 storage, site resolution, deferred work, scanning, and export limits. `local` explicitly enables development captures and simulation. It must never be inferred from user input.

## Payment providers

`PaymentProvider` currently exposes a hosted `checkout` operation and authoritative `read` operation. The implemented adapter accepts Stripe test keys only. Amounts are integer minor units derived from server-evaluated calculations. Browser totals and event metadata alone do not prove payment.

Provider callbacks must verify their raw-body signature before normalizing an event. Reconcile against the stored checkout identity and accepted amount/currency through `applyPaymentEvent`; do not update the entry status directly. Reconciliation and queued-action release use one database transaction. Paid/refunded precedence prevents stale failure/success events from undoing a later final state. The queue rechecks payment before dispatch, including manual replay. Refunds cannot undo already-delivered email or other external actions.

Adding another provider also requires an explicit typed definition option, configuration UI, callback verification, reconciliation tests, and an honest configured/unconfigured state. The current interface is not a catalog of supported external providers.

## Storage and local checks

Use additive Payload migrations for collection changes and additive SQL migrations for internal transactional ledgers. Keep historic revisions immutable and preserve original submitted answers. Never make a migration depend on changing current collection defaults when historical columns are not yet installed.

Use isolated `DESIGN_CORE_TEST_PERSIST_PATH` storage for local development. The Forms browser configuration rejects non-loopback origins. Wrangler dev places its storage under an additional `v3` directory; use a separate copy of local fixtures when checking the production bundle.

The scoped release passed 181 shared framework tests, 57 Forms integration tests, 15 development-browser scenarios, and four authenticated browser scenarios against the production Worker bundle. The Worker scenarios cover new-form creation/publication/submission, import/draft preservation, drag/undo/reload, and independent page placements. The local Worker scheduled handler returned 200. Production-mode checks confirm local capture is disabled and anonymous entry access is denied. Types, lint (warnings only), component registration and the release build passed. These checks do not establish actual external email delivery or a real Stripe transaction.
