# Registering blocks

The shared registry owns the block catalog, defaults, inspector fields, supported controls, validation, rendering, and outline text. Posts/Pages store `ContentNode` values in `contentLayout`. Template and Site Shell adapters preserve their existing layout arrays and use a layout wrapper with a `block` value and independently stored children. No relational tables or columns are added.

Register trusted application code using `registerBlock` from `@design-system/payload-design-core`. Import the same registration module in the admin application and the public rendering entry. Register before rendering either editor. Registration rejects duplicate type identifiers. Do not register components, JavaScript, or executable SVG from database values.

`src/blocks/example.tsx` contains a complete Badge definition: fields, defaults, validation, shared controls, renderer, outline text, and allowed contexts. The example is opt-in and does not add a production block merely by importing the package. The framework tests also register and render a custom block without changing an editor.

## Definition contract

- `type` is a permanent storage identifier; `version` identifies its property format. Keep identifiers stable when renaming labels.
- `contexts` lists content, template, header, and footer availability. Future collections select the content adapter.
- `fields` declares property controls, defaults, and whether a public document field may supply the value.
- `container` enables nesting; `allowedParents` and `canContain` constrain destinations across adapters. Children are independently identified blocks, not embedded markup.
- `controls` declares applicable layout, typography, background, border, image, and advanced sections. `inspector` can add custom sections under the three existing tabs.
- `validate`, `upgrade`, `render`, and `outline` extend behavior without changing each editor. Renderers must work in canvas and published output; interactive behavior belongs in a lazily loaded client module.

Register built-in additions in `src/blocks/registry.ts`. For application extensions, use one registration module shared by the server and admin bundle. Build the package after source changes so tracked `dist` exports remain synchronized.

## Presentation and data

Use responsive style values rather than duplicating device logic. Desktop is the base; tablet (1024px) and mobile (640px) inherit it. Clearing a control removes an override. Interactive styles belong to the hover/focus presentation maps. Respect reduced motion and keep animation disabled while editing.

Custom CSS accepts declarations, `&`-anchored descendant/state rules, and min/max-width media queries. It rejects global selectors, imports, URLs, executable syntax, and markup. It never modifies the admin application outside a block. Custom attributes permit validated `data-*`, `aria-*`, title, role, language, and direction values.

Conditions and bindings use the public document-field allowlist. Extend it with `registerPublicDocumentField(path)` only for fields that are safe to render publicly. Template authors can additionally bind registered properties to declared Template custom fields; content editors see the corresponding field values and guidance. Query blocks use Payload access checks and bounded page sizes: published content for public requests, authenticated draft context for editor previews. The listing endpoint is read-only and returns only presentation data. Existing routes are dynamically rendered so scheduled visibility is evaluated per request.

Keep saved data for missing definitions. Restore the original definition to edit it; do not silently replace unknown blocks. Template structure and styles remain unavailable to content-only editors.

## Verification

Run package tests/type checks and the editor Playwright suite. Include round-trip storage, responsive overrides, nesting/movement, keyboard interaction, published rendering, custom CSS boundaries, and API validation for new capabilities. Any database schema change requires a separate migration; extending these JSON fields does not.

Select a section?s named child in List View to style that part independently. Section blocks compose ordinary registered children, so they need no separate inspector. Motion stays disabled in the editor until Preview motion is pressed; reduced-motion preferences apply to that preview too.
