# Site Template architecture boundary

Phase 4 establishes persistence and contracts only. It does not render a Site Template or add a visual Header or Footer builder.

## Ownership

- **Site Settings** owns site identity and routing: site name, tagline, logo assets, favicon, homepage, blog page, social URLs, and the authoritative `defaultSiteTemplate` relationship.
- **Site Template** owns the global visual shell and design settings: independent Header and Footer trees, typography, colors, buttons, dimensions, mobile defaults, and stored Additional CSS.
- **Page/Post Template** owns content layout, template fields, document and custom-field bindings, content presentation, and Designed Blocks.
- **Block Design** owns reusable component presentation.

These models reference each other where needed, but do not duplicate ownership. In particular, Site Templates have no `isDefault` flag. `SiteSettings.defaultSiteTemplate` is the single source of truth.

## Site Shell model

`SiteShellNode` is intentionally separate from the existing `TemplateNode` content model. A Site Shell tree supports the shared layout primitives `container`, `row`, `columns`, `stack`, `spacer`, and `divider`, plus shell-specific elements reserved for future builders and renderers: logo, site name, navigation, button, search, text, rich text, icon, image, social links, mobile menu toggle, copyright, and current year.

Header and Footer each persist their own `{ layout, settings }` value. Their trees are validated independently. Phase 4 stores these values as structured JSON and exposes the regular Payload JSON editor; a later approved phase can attach a visual adapter to the shared Builder Core.

## Assignment and resolution

The only supported assignment mode is `default`, with a numeric priority reserved for deterministic future resolution. Conditional assignment and its UI are deferred until a resolver is designed and approved.

## Additional CSS

Additional CSS is stored but not rendered in Phase 4. Validation limits it to 50,000 characters and rejects `@import` and attempts to terminate a style element.

## Existing routing defaults

Before Phase 4, Site Settings had no homepage or blog-page relationship. No competing configurable routing default was found. Existing application routes remain unchanged; the new relationships are persistence-only until a frontend resolver is approved.
