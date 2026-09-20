# Visual editor architecture

## Separate template systems

### Content Templates

Content Templates define the reusable structure and presentation of similar Posts and Pages. Content values remain on each content item and are associated with stable element IDs. Publishing a Content Template can update presentation for every item using it without overwriting those values.

### Site Templates

Site Templates define the global site frame: header, navigation placements, main-content slot, footer, announcement regions, and other global chrome. They are separate records with separate permissions and rendering. Navigation remains structured content; a Site Template controls where and how it renders.

## Shared editor shell

Templates, Site Templates, Posts, Pages, and reusable Blocks use the same editor shell with context-specific permissions:

- left sidebar: block library, list view, and document outline
- center: visual canvas with contextual inserters and inline content editing
- right sidebar: document or selected-block inspector

The shell consumes a registry of element definitions. Registry entries own labels, categories, search terms, defaults, parent/child rules, inspector controls, canvas previews, frontend renderers, and validation.

## Data ownership

- Content Template: structure, stable IDs, defaults, locks, and allowed overrides
- Post/Page: content values and explicitly allowed local additions or overrides
- Block Type: reusable content contract and renderer registration
- Block Design: reusable presentation tokens for a Block Type
- Site Template: global regions and main-content placement
- Navigation/Site Settings: structured global content referenced by Site Template blocks

## Rollout order

1. Shared registry and editor shell
2. Content Template integration
3. Core blocks and inspector controls
4. Post integration
5. Page integration
6. Reusable Block Creator integration
7. Separate Site Template collection and renderer
8. Compatibility migration and controlled production rollout

The current Template JSON remains readable during this rollout. Schema migrations are introduced only when a persisted contract changes.
