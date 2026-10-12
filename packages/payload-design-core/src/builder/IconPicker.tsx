'use client'
import { useState } from 'react'
import { BlockIcon, iconPaths } from '../blocks/Icons'
export function IconPicker({ value, change }: { value: string; change: (value: string) => void }) {
  const [search, setSearch] = useState('')
  return (
    <div>
      <input
        aria-label="Search icons"
        placeholder="Search icons"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="inspector-icon-grid">
        {Object.keys(iconPaths)
          .filter((name) => name.includes(search.toLowerCase()))
          .map((name) => (
            <button
              type="button"
              key={name}
              title={name}
              aria-label={name}
              aria-pressed={value === name}
              onClick={() => change(name)}
            >
              <BlockIcon name={name} />
            </button>
          ))}
      </div>
    </div>
  )
}
