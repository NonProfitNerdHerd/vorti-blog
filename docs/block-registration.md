# Registering blocks, variations, and styling targets

The shared registry is `packages/payload-design-core/src/blocks/registry.ts`. Register once in a module loaded by both the application renderer/validation entry and the admin entry. Do not register separately in each editor. Definitions must be identical on the server and client; registration is code-owned, never accepted from document JSON.

A definition supplies its stable type/version, contexts, defaults, fields, supported controls, renderer, optional inspector sections, validation/upgrades, outline text and nesting rules. Existing Designed Blocks continue to use their registered design/content contract.

```tsx
import { registerBlock } from '@design-system/payload-design-core/content'

registerBlock({
  type: 'projectBadge',
  version: 1,
  label: 'Project badge',
  icon: '?',
  description: 'A short project label.',
  category: 'Text',
  keywords: ['badge', 'project'],
  contexts: ['content', 'template', 'header', 'footer'],
  fields: [{ key: 'label', label: 'Label', type: 'text', defaultValue: 'Project' }],
  controls: ['layout', 'typography', 'background', 'border', 'advanced'],
  variations: [
    { id: 'plain', label: 'Plain', thumbnail: 'stack', styles: { desktop: { padding: '8px' } } },
    {
      id: 'framed',
      label: 'Framed',
      thumbnail: 'stack',
      styles: { desktop: { padding: '16px', borderWidth: '1px', borderColor: '#888888' } },
    },
  ],
  targets: [{ id: 'label', label: 'Label', selector: '.project-badge-label' }],
  render: (node) => (
    <span className="project-badge-label">{String(node.props?.label ?? 'Project')}</span>
  ),
  outline: (node) => String(node.props?.label ?? 'Project'),
})
```

Keep client registration modules free of server-only dependencies. The package's existing content/admin registration wiring is the model to follow. The executable custom-registration test is in `blocks/framework.test.tsx`; it proves insertion/defaults, rendering, variations, and both storage adapters without editing their implementations.

## Variations and content ownership

- `variations` contains stable IDs, human labels, a schematic thumbnail (`stack`, `split`, `overlay`, `grid`) and optional responsive default styles. Built-in compound layouts additionally use `Composition` and `variations.css`.
- New blocks select their default variation; multivariant block insertion opens an editor-only chooser. Skip selects the first/default variation. Style-only button/social choices do not interrupt insertion.
- Persist only `{ id, version: 1 }` in `node.variation`. Defaults remain registered code. Authored `node.styles` wins over defaults, including inherited authored values.
- Layout changes never regenerate children. Roles (`heading`, `description`, `media`, `actions`, `item`, `extra`) describe their purpose. Existing untagged children are inferred by kind. Unmatched children remain ordered in an additional-content area.
- `applyVariation` retains content, IDs, media, bindings, targets and authored styles. `resetLayoutStyles` removes layout overrides only; it does not delete content or typography/colors. Duplicating creates new IDs throughout the subtree.
- Existing nodes without `variation` do not receive variation styles. Use explicit upgrades only for compatible data reading; never restyle saved documents merely because new defaults exist.

## Styling targets and media

Targets are code-owned selectors beneath the block's unique scope. Store normal responsive target overrides in `node.targetStyles[targetID]`; the shared renderer generates the same rules for canvas, draft preview and public output. Register a semantic target instead of creating another inspector. Avoid inline properties that prevent the target's stylesheet from taking effect.

The current target contract supports normal Desktop/Tablet/Phone overrides. Block-level hover/focus presentation stays separate; do not imply responsive interaction-state storage.

`presentation.background` stores image/overlay/mode defaults plus optional tablet/mobile property overrides. Unset fields inherit from larger devices. Reset deletes overrides. Existing URL backgrounds and scalar colors/gradients remain supported. Media selection stores the selected media ID and its resolved URL. Overlays render as independent layers, never opacity on text/content. All values pass shared server validation.

Interactive panel navigation belongs in local React state, not document props. Persist only initial-open settings. Use `EditingSelection` to reveal selected nested content and retain native keyboard/focus behavior. Motion/autoplay must stay off during ordinary editing and honor reduced motion publicly.

## Required checks

Add coverage for every new variation to the registry-driven preservation/rendering tests. Include a representative browser insertion/edit/save/reload flow, keyboard behavior if interactive, access/lock checks, and preview/public rendering. Use `BLOCK_REVIEW_PATH` with the framework tests to generate the layout review fixture. No editor-specific switch statement, database column or migration is needed for an ordinary registered block.
