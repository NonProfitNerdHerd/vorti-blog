'use client'
import { useField } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import { BlockGlyph } from '@design-system/payload-design-core/admin'
import { listBlockDefinitions } from '@design-system/payload-design-core/content'
import { useState } from 'react'
export const TypeIcon: TextFieldClientComponent = ({ path, readOnly }) => {
  const { value, setValue } = useField<string>({ path })
  const [search, setSearch] = useState('')
  return (
    <fieldset disabled={readOnly} className="cf-editor">
      <legend>Post Type icon</legend>
      <input
        type="search"
        aria-label="Search icons"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="cf-icon-picker">
        {listBlockDefinitions()
          .filter((item) => item.label.toLowerCase().includes(search.toLowerCase()))
          .map((item) => (
            <button
              type="button"
              key={item.type}
              title={item.label}
              aria-label={item.label}
              aria-pressed={value === item.type}
              onClick={() => setValue(item.type)}
            >
              <BlockGlyph kind={item.type} />
            </button>
          ))}
      </div>
    </fieldset>
  )
}
