'use client'
import { usePostTypeAccess } from './usePostTypeAccess'
import { useState } from 'react'
import { useDocumentInfo, useField } from '@payloadcms/ui'
import type { JSONFieldClientComponent } from 'payload'
import type { TypeField } from '@design-system/payload-design-core/content'
import { listContentCapabilities } from '@design-system/payload-design-core/content'
import { TypeFieldBuilder } from '@design-system/payload-design-core/admin'
import { TypeValueForm } from './TypeValues'
import { RelationPicker } from './ViewBuilder'
import { restoreRequiredField } from './type-field-requirements'
import './post-type.css'
export const FieldsEditor: JSONFieldClientComponent = ({ path, readOnly: inheritedReadOnly }) => {
  const access = usePostTypeAccess(inheritedReadOnly)
  const readOnly = !access.canWrite(path)
  const { value = [], setValue, errorMessage, showError } = useField<TypeField[]>({ path })
  const { value: capability } = useField<string>({ path: 'capability' })
  const requiredKinds =
    listContentCapabilities().find((item) => item.key === capability)?.requiredKinds || []
  const { data, id } = useDocumentInfo()
  const [sample, setSample] = useState<Record<string, unknown>>({})
  return (
    <>
      {requiredKinds
        .filter((kind) => !value.some((f) => f.kind === kind && f.public && f.required))
        .map((kind) => (
          <div className="pt-protected" key={kind}>
            <p>
              This behavior requires a public, required{' '}
              {kind === 'eventSchedule' ? 'Event Schedule' : kind} field.
            </p>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setValue(restoreRequiredField(value, kind))}
            >
              Restore {kind === 'eventSchedule' ? 'Event Schedule' : kind}
            </button>
          </div>
        ))}
      <TypeFieldBuilder
        fields={value}
        onChange={setValue}
        savedFields={id ? ((data?.fieldDefinitions || []) as TypeField[]) : []}
        disabled={readOnly}
        requiredKinds={requiredKinds}
        serverError={showError && typeof errorMessage === 'string' ? errorMessage : undefined}
        preview={
          <TypeValueForm
            fields={value}
            label="Sample content"
            value={{
              ...Object.fromEntries(
                value
                  .filter((f) => f.defaultValue !== undefined)
                  .map((f) => [f.id, f.defaultValue]),
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
    </>
  )
}
