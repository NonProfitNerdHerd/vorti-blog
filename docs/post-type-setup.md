# Post Type setup

Post Types now use the same eight-step wizard for creation and editing. The native document header owns saving, publishing, Versions, and API navigation. A presentational Payload row groups the existing fields; their storage paths are unchanged.

1. Choose a permanent key, such as `event`.
2. Enter singular and plural labels, such as Event and Events.
3. Choose the permanent URL prefix, such as `events`.
4. Choose Content or a registered capability. Event supplies a required public Event Schedule field.
5. Search the bundled Lucide library, including Calendar.
6. Add and reorder fields, configure publication rules, and try sample values in the author-form preview.
7. Choose allowed published Page/Post Templates and an optional default. Without a Template, the built-in presentation remains available.
8. Review configuration and save a draft or publish using the native header.

Keys and prefixes become fixed after the first save. Saved field IDs and types cannot be changed or removed, because content and Template bindings reference them. Duplicate a field or add a replacement instead. Template selection never changes field values.

## Field rules

Rules are typed JSON in `TypeField.rules`; no database columns or migrations are added. `availableRules`, `validateRuleDefinitions`, and `evaluateFieldRules` are exported from the shared framework's root and content entrypoints. Evaluations return `{ field, message }` issues. The application validates definition shape and defaults, resolves accessible relationship/media records, and enforces the same rules before content publication.

Supported rules include conditional required, text length/email/text matching, numeric bounds and integers, sibling numeric/date comparisons, date bounds, URL protocols/domains, checkbox acceptance, and media MIME/file-size restrictions. Comparisons reference stable field IDs, not labels. Domain matching is exact, including subdomains; MIME rules may use `image/*` syntax. No arbitrary code or regular expressions are accepted.

For an End field choose Compare with another field → Start → Must be after → Allow equal values. Missing Start fails that comparison when End has a value. Mark Start and End required if both must always be present. Optional empty fields skip value rules; Must be checked requires true. Conditional required treats false and zero as values.

Offset-less date inputs represent wall-clock values and compare as UTC for deterministic behavior. Offset-bearing values compare as instants. Event Schedule remains the recommended way to model actual events, with its existing timezone and recurrence validation. Ordinary date fields do not infer a timezone from the server.

Business-rule failures are shown during editing and block publication, but allow draft saves. Structural, safe-URL, relationship-access, and Event Schedule checks still run on every save. Tightening a definition does not rewrite or unpublish existing content; its next publication must pass the new definition. Draft definition changes remain separate from the published definition.

Media rules use metadata fetched through access-checked application adapters. Browser metadata is never authoritative. Preview values remain component state and are not written to Payload form data.

## Icons and extension

New icon references use `lucide:IconName`; existing block-icon references retain their renderer. `PostTypeIcon` resolves both. The full local Lucide catalog loads only when requested; the picker renders 60 results at a time. No external icon service or SVG uploads are involved.

Shared admin exports include `SetupWizard`, `TypeFieldBuilder`, `PostTypeIconPicker`, and `PostTypeIcon`. New field rules must be registered in the shared typed contract, compatible-rule list, definition validator, evaluator, and editor with positive and negative tests. Persistence and access checks stay in the application adapter.

The workflow applies to Post Type fields only. Forms and Template field builders remain unchanged. Defaults use field-appropriate controls, including the schedule editor and media/relationship pickers. The standalone preview/default editor accepts plain text for rich text; content authors retain their existing formatted-text editor.

## Local review

Run `post-type-wizard.e2e.spec.ts` using the local-only Worker editor Playwright configuration. It exercises wizard creation, Calendar selection, preview isolation, saved-field protections, native publication, mobile layout, and direct API draft/publication behavior. Unit coverage in `field-rules.test.ts` exercises every rule family, bounds, invalid defaults, sibling references, offsets, and trusted media metadata.
