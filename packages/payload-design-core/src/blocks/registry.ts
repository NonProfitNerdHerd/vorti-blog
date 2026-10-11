import type { ReactNode } from 'react'
import type { ContentNode } from '../content/model'

export type BlockContext = 'content' | 'template' | 'header' | 'footer'
export type InspectorSection = 'layout' | 'style' | 'advanced'
export type BlockField = {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'toggle' | 'select' | 'url' | 'date' | 'icon'
  options?: string[]
  defaultValue?: string | number | boolean
  min?: number
  max?: number
  bindable?: boolean
}
export type BlockDefinition = {
  type: string
  version: number
  label: string
  icon: string
  description: string
  category: string
  keywords: string[]
  contexts: BlockContext[]
  container?: boolean
  allowedParents?: string[]
  canContain?: (parent: ContentNode, child: ContentNode) => boolean
  fields: BlockField[]
  controls: Array<'layout' | 'typography' | 'background' | 'border' | 'image' | 'advanced'>
  defaults?: Partial<ContentNode>
  validate?: (node: ContentNode) => string | undefined
  upgrade?: (node: ContentNode) => ContentNode
  render?: (node: ContentNode, children: ReactNode) => ReactNode
  outline?: (node: ContentNode) => string
  inspector?: Partial<
    Record<
      InspectorSection,
      (node: ContentNode, change: (patch: Partial<ContentNode>) => void) => ReactNode
    >
  >
}

const entries = new Map<string, BlockDefinition>()
export function registerBlock(definition: BlockDefinition) {
  if (entries.has(definition.type))
    throw new Error(`Duplicate block definition: ${definition.type}`)
  entries.set(definition.type, definition)
}
export const getBlockDefinition = (type: string) => entries.get(type)
export const listBlockDefinitions = (context: BlockContext = 'content') =>
  [...entries.values()].filter((item) => item.contexts.includes(context))
export function canInsertBlock(parent: ContentNode | undefined, child: ContentNode) {
  const definition = getBlockDefinition(child.kind),
    parentDefinition = parent ? getBlockDefinition(parent.kind) : undefined
  if (definition?.allowedParents && !definition.allowedParents.includes(parent?.kind ?? 'root'))
    return false
  if ((parent?.kind === 'columns') !== (child.kind === 'column')) return false
  return (
    !parent ||
    (!!parentDefinition?.container &&
      (!parentDefinition.canContain || parentDefinition.canContain(parent, child)))
  )
}

const field = (
  key: string,
  label: string,
  type: BlockField['type'] = 'text',
  defaultValue?: BlockField['defaultValue'],
  options?: string[],
): BlockField => ({
  key,
  label,
  type,
  defaultValue,
  options,
  bindable: ['text', 'textarea', 'url', 'number', 'date'].includes(type),
})
const valueFields = [
  field('value', 'Value', 'number', 60),
  field('max', 'Maximum', 'number', 100),
  field('label', 'Label', 'text', 'Progress'),
]
const queryFields = [
  field('collection', 'Collection', 'select', 'posts', ['posts', 'pages']),
  field('presentation', 'Presentation', 'select', 'grid', ['grid', 'list']),
  field('limit', 'Items per page', 'number', 6),
  field('sort', 'Sort', 'select', '-publishedAt', [
    '-publishedAt',
    'publishedAt',
    'title',
    '-updatedAt',
  ]),
  field('ids', 'Selected document IDs (comma separated)'),
  field('categories', 'Category IDs (comma separated)'),
  ...['image', 'title', 'excerpt', 'taxonomy', 'date', 'link'].map((key) =>
    field(`show${key[0].toUpperCase()}${key.slice(1)}`, `Show ${key}`, 'toggle', true),
  ),
]
const linkFields = [field('label', 'Label', 'text', 'Learn more'), field('url', 'URL', 'url')]
const catalog: Array<[string, string, string, string, boolean?, BlockField[]?]> = [
  ['heading', 'Heading', 'H', 'Text'],
  ['paragraph', 'Paragraph', '¶', 'Text'],
  ['richText', 'Rich Text', '¶', 'Text'],
  ['list', 'List', '☷', 'Text'],
  ['quote', 'Block Quote', '❞', 'Text'],
  ['image', 'Image', '▧', 'Media'],
  ['gallery', 'Gallery', '▧', 'Media'],
  ['video', 'Video', '▶', 'Media'],
  ['button', 'Button', '▰', 'Text'],
  ['group', 'Container', '□', 'Layout', true],
  ['row', 'Row', '↔', 'Layout', true],
  ['columns', 'Columns', '▥', 'Layout', true],
  ['column', 'Column', '▯', 'Layout', true],
  ['spacer', 'Spacer', '↕', 'Layout'],
  ['divider', 'Divider', '―', 'Layout'],
  [
    'iconButton',
    'Icon Button',
    '★',
    'Text',
    false,
    [...linkFields, field('icon', 'Icon', 'icon', 'arrow')],
  ],
  [
    'iconList',
    'Icon List',
    '☷',
    'Text',
    false,
    [
      field('items', 'Items (one per line)', 'textarea', 'First item\nSecond item'),
      field('icon', 'Icon', 'icon', 'check'),
    ],
  ],
  [
    'icon',
    'Icon',
    '★',
    'Media',
    false,
    [field('icon', 'Icon', 'icon', 'star'), field('label', 'Accessible label')],
  ],
  ['text', 'Text', '¶', 'Text', false, [field('text', 'Text', 'textarea', 'Write your text')]],
  [
    'accordion',
    'Accordion',
    '⌄',
    'Interactive',
    true,
    [field('multiple', 'Allow multiple open panels', 'toggle', false)],
  ],
  [
    'notification',
    'Notification',
    '!',
    'Interactive',
    true,
    [field('dismissible', 'Dismissible', 'toggle', true)],
  ],
  [
    'carousel',
    'Carousel',
    '▧',
    'Interactive',
    true,
    [
      field('autoplay', 'Autoplay', 'toggle', false),
      field('interval', 'Slide interval (seconds)', 'number', 5),
    ],
  ],
  ['horizontalScroller', 'Horizontal Scroller', '↔', 'Interactive', true],
  [
    'expand',
    'Expand',
    '⌄',
    'Interactive',
    true,
    [
      field('label', 'Expand label', 'text', 'Read more'),
      field('collapseLabel', 'Collapse label', 'text', 'Show less'),
    ],
  ],
  ['tabs', 'Tabs', '▤', 'Interactive', true],
  [
    'videoPopup',
    'Video Popup',
    '▶',
    'Interactive',
    false,
    [field('url', 'Video URL', 'url'), field('label', 'Play label', 'text', 'Play video')],
  ],
  ['progressBar', 'Progress Bar', '━', 'Indicators', false, valueFields],
  ['progressCircle', 'Progress Circle', '◯', 'Indicators', false, valueFields],
  [
    'numberBox',
    'Number Box',
    '#',
    'Indicators',
    false,
    [field('value', 'Number', 'number', 1), field('label', 'Label', 'text', 'Step')],
  ],
  [
    'countUp',
    'Count Up',
    '#',
    'Indicators',
    false,
    [
      field('start', 'Start', 'number', 0),
      field('value', 'End', 'number', 100),
      field('duration', 'Duration (seconds)', 'number', 2),
      field('prefix', 'Prefix'),
      field('suffix', 'Suffix'),
    ],
  ],
  [
    'countdown',
    'Countdown',
    '◷',
    'Indicators',
    false,
    [
      field('deadline', 'Deadline (ISO date with timezone)', 'date'),
      field('completeText', 'Completion text', 'text', 'The time has arrived'),
    ],
  ],
  [
    'separator',
    'Separator',
    '〰',
    'Layout',
    false,
    [
      field('shape', 'Shape', 'select', 'wave', ['wave', 'angle', 'curve']),
      field('flip', 'Flip', 'toggle', false),
    ],
  ],
  [
    'socialButtons',
    'Social Buttons',
    '↗',
    'Text',
    false,
    [field('links', 'Links (label | URL, one per line)', 'textarea')],
  ],
  ['card', 'Card', '▣', 'Sections', true],
  [
    'iconLabel',
    'Icon Label',
    '★',
    'Text',
    false,
    [field('icon', 'Icon', 'icon', 'check'), field('label', 'Label', 'text', 'Label')],
  ],
  ['subtitle', 'Subtitle', 'T', 'Text', false, [field('text', 'Text', 'text', 'Subtitle')]],
  ['imageBox', 'Image Box', '▧', 'Sections', true],
  [
    'price',
    'Price',
    '$',
    'Text',
    false,
    [
      field('currency', 'Currency', 'text', '$'),
      field('value', 'Amount', 'text', '29'),
      field('period', 'Period', 'text', '/ month'),
    ],
  ],
  [
    'map',
    'Map',
    '⌖',
    'Media',
    false,
    [
      field('latitude', 'Latitude', 'number', 44.5),
      field('longitude', 'Longitude', 'number', -89.5),
      field('zoom', 'Zoom', 'number', 10),
      field('marker', 'Show marker', 'toggle', true),
    ],
  ],
  [
    'tableOfContents',
    'Table of Contents',
    '☷',
    'Data',
    false,
    [
      field('minLevel', 'Minimum heading level', 'number', 2),
      field('maxLevel', 'Maximum heading level', 'number', 6),
    ],
  ],
  ['postListing', 'Blog Post / Listing', '▤', 'Data', false, queryFields],
  ['pagination', 'Pagination', '↔', 'Data', false, [field('listingID', 'Listing block ID')]],
  [
    'loadMore',
    'Load More',
    '+',
    'Data',
    false,
    [field('listingID', 'Listing block ID'), field('label', 'Label', 'text', 'Load more')],
  ],
  ...(
    [
      'hero',
      'testimonial',
      'callToAction',
      'iconBox',
      'timeline',
      'feature',
      'pricingBox',
      'featureGrid',
      'teamMember',
    ] as const
  ).map(
    (type) =>
      [
        type,
        type.replace(/[A-Z]/g, (c) => ` ${c}`).replace(/^./, (c) => c.toUpperCase()),
        '▣',
        'Sections',
        true,
      ] as [string, string, string, string, boolean],
  ),
]
for (const [type, label, icon, category, container, fields = []] of catalog)
  registerBlock({
    type,
    label,
    icon,
    category,
    container,
    fields,
    version: 1,
    description: `${label} content with responsive layout and presentation controls.`,
    keywords: [type, label.toLowerCase()],
    contexts: ['content', 'template', 'header', 'footer'],
    controls: [
      'layout',
      'typography',
      'background',
      'border',
      ...(type === 'image' ? ['image' as const] : []),
      'advanced',
    ],
  })

export function blockDefaults(kind: string): Partial<ContentNode> {
  const definition = getBlockDefinition(kind)
  if (!definition) return {}
  const child = (kind: string, text?: string): ContentNode => ({
    id: `b_${crypto.randomUUID()}`,
    kind,
    text,
    label: getBlockDefinition(kind)?.label,
    ...blockDefaults(kind),
  })
  let children: ContentNode[] | undefined = definition.container ? [] : undefined
  if (['accordion', 'tabs', 'carousel'].includes(kind))
    children = [1, 2].map((index) => ({
      ...child('group'),
      label: `Item ${index}`,
      children: [child('paragraph', `Content for item ${index}`)],
    }))
  if (definition.category === 'Sections')
    children = [
      ...(kind === 'imageBox' || kind === 'teamMember' ? [child('image')] : []),
      child('heading', definition.label),
      child('paragraph', 'Add your content here'),
      ...(['hero', 'callToAction', 'pricingBox'].includes(kind)
        ? [child('button', 'Learn more')]
        : []),
    ]
  if (kind === 'pricingBox')
    children = [
      child('heading', 'Plan name'),
      child('price'),
      child('iconList'),
      child('button', 'Choose plan'),
    ]
  if (kind === 'testimonial')
    children = [child('quote', 'Customer testimonial'), child('paragraph', 'Name and role')]
  if (kind === 'iconBox')
    children = [
      child('icon'),
      child('heading', 'Feature title'),
      child('paragraph', 'Describe this feature'),
    ]
  if (kind === 'feature')
    children = [
      child('image'),
      child('heading', 'Feature title'),
      child('paragraph', 'Describe this feature'),
    ]
  if (kind === 'teamMember')
    children = [
      child('image'),
      child('heading', 'Team member name'),
      child('paragraph', 'Role and biography'),
      child('socialButtons'),
    ]
  if (kind === 'featureGrid') children = [child('iconBox'), child('iconBox'), child('iconBox')]
  if (kind === 'timeline')
    children = [1, 2, 3].map((index) => ({
      ...child('group'),
      label: `Timeline item ${index}`,
      styles: {
        desktop: {
          borderWidth: '2px',
          borderColor: '#cccccc',
          padding: '16px',
          margin: '0 0 12px 24px',
        },
      },
      children: [
        child('heading', `Milestone ${index}`),
        child('paragraph', 'Date and description'),
      ],
    }))
  const styles =
    kind === 'featureGrid'
      ? {
          desktop: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' },
          tablet: { gridTemplateColumns: '1fr 1fr' },
          mobile: { gridTemplateColumns: '1fr' },
        }
      : definition.category === 'Sections'
        ? { desktop: { padding: '24px' } }
        : undefined
  return {
    blockVersion: definition.version,
    props: Object.fromEntries(
      definition.fields
        .filter((field) => field.defaultValue !== undefined)
        .map((field) => [field.key, field.defaultValue]),
    ),
    ...(children ? { children } : {}),
    ...(styles ? { styles } : {}),
    ...definition.defaults,
  }
}
