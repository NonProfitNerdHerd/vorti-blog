'use client'
import { usePostTypeAccess } from './usePostTypeAccess'
import { useState } from 'react'
import { useDocumentInfo, useField } from '@payloadcms/ui'
import type { JSONFieldClientComponent } from 'payload'
import type { TypeField } from '@design-system/payload-design-core/content'
import { TypeFieldBuilder } from '@design-system/payload-design-core/admin'
import { TypeValueForm } from './TypeValues'
import { RelationPicker } from './ViewBuilder'
import './post-type.css'
export const FieldsEditor: JSONFieldClientComponent = ({ path, readOnly: inheritedReadOnly }) => {
  const access = usePostTypeAccess(inheritedReadOnly)
  const readOnly = !access.canWrite(path)
  const { value = [], setValue } = useField<TypeField[]>({ path })
  const { data, id } = useDocumentInfo()
  const [sample, setSample] = useState<Record<string, unknown>>({})
  return (
    <TypeFieldBuilder
      fields={value}
      onChange={setValue}
      savedFields={id ? ((data?.fieldDefinitions || []) as TypeField[]) : []}
      disabled={readOnly}
      preview={
        <TypeValueForm
          fields={value}
          label="Sample content"
          value={{
            ...Object.fromEntries(
              value.filter((f) => f.defaultValue !== undefined).map((f) => [f.id, f.defaultValue]),
            ),
            ...sample,
          }}
          onChange={setSample}
          readOnly={readOnly}
        />
      }
      renderDefault={(field, change) =>
        ['richText', 'eventSchedule'].includes(field.kind) ? (
          <div>
            <TypeValueForm
              fields={[{ ...field, required: false, rules: [] }]}
              label="Default value (optional)"
              value={{ [field.id]: field.defaultValue }}
              onChange={(values) => change(values[field.id])}
              readOnly={readOnly}
            />
            <button type="button" disabled={readOnly} onClick={() => change(undefined)}>
              Clear default
            </button>
          </div>
        ) : (
          <RelationPicker
            label="Default item (optional)"
            collection={field.kind === 'media' ? 'media' : field.relationTo || 'posts'}
            value={field.defaultValue ? [String(field.defaultValue)] : []}
            single
            disabled={readOnly}
            onChange={(ids) => change(ids[0] ? Number(ids[0]) : undefined)}
          />
        )
      }
    />
  )
}
