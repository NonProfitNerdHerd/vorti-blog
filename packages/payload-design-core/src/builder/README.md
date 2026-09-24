# Builder Core boundary

This directory contains the schema-neutral interaction layer shared by visual
builders. `TemplateBuilder.tsx` consumes this layer while retaining all
Page/Post Template document behavior in its content adapter.

## Architectural ownership

- **Site Settings** own site identity and routing: name, tagline, logo assets,
  favicon, homepage, blog page, social URLs, and the default Site Template
  relationship.
- **Site Templates** own the global visual shell: header, footer,
  typography, colors, buttons, content widths, responsive defaults, and
  additional CSS.
- **Page/Post Templates** own content layout, template fields, content
  presentation, and placement of Designed Blocks.
- **Block Designs** own reusable component presentation.

An adapter must not expose another system's fields as if they belong to its
document. Builder Core coordinates editing mechanics only.

## Extracted responsibilities

The following parts of `admin/TemplateBuilder.tsx` are now provided by Builder
Core:

1. `LibraryButton`
2. `DropArea`
3. The picker dialog shell, search, and category tabs in `ElementPicker`
4. Recursive canvas traversal in `Tree` and the layout portions of
   `CanvasNode`
5. Recursive List View traversal in `ListTree`
6. DnD sensor setup and the distinction between library insertion and moving
   an existing node
7. The Settings, Style, and Advanced inspector tab shell

Each adapter owns selection and sidebar visibility because those states
coordinate its document-specific panels. Builder Core provides the shared
responsive preview toolbar and viewport frame.

These parts remain specific to the Page/Post Template adapter:

1. Payload paths such as `layout`, `customFields`, `sections`, and
   `allowedCollections`
2. Template dependency loading and removal confirmation
3. Template draft/publish submission overrides
4. `CustomFieldsPanel`
5. Document and custom-field content bindings
6. Block Type, Block Design, and slot-mapping controls
7. Template validation and legacy `sections` compatibility
8. Template-specific labels and empty states

## Site Shell adapter

`SiteShellBuilder` is the single adapter used for both Header and Footer. It
owns the Site Shell element registry, region filtering, node creation,
inspector controls, shell previews, and the `header.layout` / `footer.layout`
Payload form paths. Header and Footer do not have separate builder engines.

The generic responsive preview toolbar lives in Builder Core and is shared by
the content and shell adapters. Responsive Site Shell style values use
`{ desktop, tablet?, mobile? }`; existing scalar content-template styles are
unchanged and continue to mean their original desktop/default value.

## Refactor safeguards

- Stored `TemplateNode` JSON must remain compatible.
- Existing Payload collection slugs and form paths must remain unchanged.
- Existing scalar style values retain their meaning.
- Builder Core must not import Payload collection configuration.
- Content and shell adapters may share editing mechanics but not document
  responsibilities.
- Builder Core changes must preserve content Template persisted data and save
  behavior, with the Template Builder regression suite passing after changes.
