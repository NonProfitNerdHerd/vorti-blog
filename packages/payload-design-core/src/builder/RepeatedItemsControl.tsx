'use client'
import { createContentNode, duplicateContent, type ContentNode } from '../content/model'
import { IconPicker } from './IconPicker'
import { beginInspectorGesture, endInspectorGesture } from './InspectorControls'
export function RepeatedItemsControl({
  node,
  change,
}: {
  node: ContentNode
  change: (patch: Partial<ContentNode>) => void
}) {
  if (!['tabs', 'accordion', 'carousel', 'timeline', 'featureGrid'].includes(node.kind)) return null
  const items = node.children ?? []
  const commit = (children: ContentNode[]) => {
    beginInspectorGesture()
    try {
      change({ children })
    } finally {
      endInspectorGesture()
    }
  }
  return (
    <details open>
      <summary>Items</summary>
      {items.map((item, index) => (
        <div key={item.id}>
          <label>
            Item {index + 1} label
            <input
              value={item.label ?? ''}
              onChange={(event) =>
                change({
                  children: items.map((child) =>
                    child.id === item.id ? { ...child, label: event.target.value } : child,
                  ),
                })
              }
            />
          </label>
          {node.kind === 'tabs' && (
            <IconPicker
              value={String(item.props?.tabIcon ?? '')}
              change={(tabIcon) =>
                change({
                  children: items.map((child) =>
                    child.id === item.id ? { ...child, props: { ...child.props, tabIcon } } : child,
                  ),
                })
              }
            />
          )}
          <button
            type="button"
            disabled={index === 0}
            onClick={() => {
              const next = [...items]
              ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
              commit(next)
            }}
          >
            Move item up
          </button>
          <button
            type="button"
            onClick={() =>
              commit([
                ...items.slice(0, index + 1),
                duplicateContent(item),
                ...items.slice(index + 1),
              ])
            }
          >
            Duplicate item
          </button>
          <button
            type="button"
            onClick={() => commit(items.filter((child) => child.id !== item.id))}
          >
            Remove item
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const item = createContentNode(node.kind === 'featureGrid' ? 'iconBox' : 'group')
          item.label = `Item ${items.length + 1}`
          if (node.kind !== 'featureGrid')
            item.children = [{ ...createContentNode('paragraph'), text: 'Add item content' }]
          if (node.kind === 'timeline') {
            item.role = 'item'
            item.props = { date: '', marker: String(items.length + 1) }
          }
          commit([...items, item])
        }}
      >
        Add item
      </button>
    </details>
  )
}
