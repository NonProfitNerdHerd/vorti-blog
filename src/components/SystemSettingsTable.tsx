'use client'
import { useEffect, useRef } from 'react'
import { useDocumentInfo, useField } from '@payloadcms/ui'
import type { CheckboxFieldClientComponent } from 'payload'
import './system-settings.css'

export const SystemSettingsTable: CheckboxFieldClientComponent = ({ path, readOnly }) => {
  const { value = true, setValue } = useField<boolean>({ path })
  const { data } = useDocumentInfo()
  const savedValue = data?.categoriesEnabled
  const previous = useRef(savedValue)
  useEffect(() => {
    if (previous.current !== savedValue) window.dispatchEvent(new Event('system-settings-saved'))
    previous.current = savedValue
  }, [savedValue])
  return (
    <div className="system-settings-table-scroll">
      <table className="system-settings-table">
        <caption className="sr-only">Site features</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Description</th>
            <th scope="col">Enabled</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Categories</th>
            <td id="categories-setting-description">
              Show category management, selection, filters, and public labels. Turning this off
              preserves existing categories, assignments, and saved listing rules.
            </td>
            <td>
              <label className="system-settings-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Categories"
                  aria-describedby="categories-setting-description"
                  checked={value}
                  disabled={readOnly}
                  onChange={(event) => setValue(event.target.checked)}
                />
                <span aria-hidden="true" className="system-settings-switch__track" />
                <span>{value ? 'On' : 'Off'}</span>
              </label>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="system-settings-help">
        Save your changes to apply this setting across the site.
      </p>
    </div>
  )
}
