# Builder Core boundary

This directory defines the boundary for a future shared visual builder. It is
type-only in this phase. `TemplateBuilder.tsx` continues to own all current
runtime behavior.

## Architectural ownership

- **Site Settings** own site identity and routing: name, tagline, logo assets,
  favicon, homepage, blog page, social URLs, and the default Site Template
  relationship.
- **Site Templates** will own the global visual shell: header, footer,
  typography, colors, buttons, content widths, responsive defaults, and
  additional CSS.
- **Page/Post Templates** own content layout, template fields, content
  presentation, and placement of Designed Blocks.
- **Block Designs** own reusable component presentation.

An adapter must not expose another system's fields as if they belong to its
document. Builder Core coordinates editing mechanics only.

## Approved extraction boundary

The following parts of `admin/TemplateBuilder.tsx` are schema-neutral and can
be extracted in the next phase after their regression tests remain green:

1. `LibraryButton`
2. `DropArea`
3. The picker dialog shell, search, and category tabs in `ElementPicker`
4. Recursive canvas traversal in `Tree` and the layout portions of
   `CanvasNode`
5. Recursive List View traversal in `ListTree`
6. DnD sensor setup and the distinction between library insertion and moving
   an existing node
7. Sidebar, canvas, inspector, and responsive preview framing
8. Selection state and open/close state for the library and inspector

These parts remain specific to the current Page/Post Template adapter:

1. Payload paths such as `layout`, `customFields`, `sections`, and
   `allowedCollections`
2. Template dependency loading and removal confirmation
3. Template draft/publish submission overrides
4. `CustomFieldsPanel`
5. Document and custom-field content bindings
6. Block Type, Block Design, and slot-mapping controls
7. Template validation and legacy `sections` compatibility
8. Template-specific labels and empty states

## Refactor safeguards

- Stored `TemplateNode` JSON must remain compatible.
- Existing Payload collection slugs and form paths must remain unchanged.
- Existing scalar style values retain their meaning.
- Builder Core must not import Payload collection configuration.
- Content and shell adapters may share editing mechanics but not document
  responsibilities.
- No extraction should change the current Template Builder DOM or save
  behavior until its regression suite passes before and after the change.
