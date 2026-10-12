'use client'
import { blockItems, type BlockListItem } from '../blocks/items'
import { IconPicker } from './IconPicker'
export function ItemsEditor({
  value,
  change,
  social = false,
}: {
  value: unknown
  change: (value: BlockListItem[]) => void
  social?: boolean
}) {
  const items = blockItems(value, social)
  const update = (index: number, patch: Partial<BlockListItem>) =>
    change(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  return (
    <div>
      {items.map((item, index) => (
        <fieldset key={index}>
          <legend>
            {social ? 'Link' : 'Item'} {index + 1}
          </legend>
          <label>
            Label
            <input
              value={item.label}
              onChange={(event) => update(index, { label: event.target.value })}
            />
          </label>
          <label>
            Link URL
            <input
              value={item.url ?? ''}
              onChange={(event) => update(index, { url: event.target.value })}
            />
          </label>
          <details>
            <summary>Icon</summary>
            <IconPicker value={item.icon ?? 'check'} change={(icon) => update(index, { icon })} />
          </details>
          <button
            type="button"
            disabled={index === 0}
            onClick={() => {
              const next = [...items]
              ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
              change(next)
            }}
          >
            Move item up
          </button>
          <button type="button" onClick={() => change(items.filter((_, i) => i !== index))}>
            Remove item
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          change([
            ...items,
            { label: social ? 'Website' : 'New item', icon: social ? 'globe' : 'check' },
          ])
        }
      >
        Add {social ? 'link' : 'item'}
      </button>
    </div>
  )
}
