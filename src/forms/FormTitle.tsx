'use client'
import { TextField, useFormFields } from '@payloadcms/ui'
import { useState } from 'react'
import type { TextFieldClientComponent } from 'payload'
import { EditorHeaderPortal } from '@design-system/payload-design-core/admin'
import { useCollectionEditorAccess } from '../content-framework/useCollectionEditorAccess'

export const FormTitle: TextFieldClientComponent = props => {
  const state = useFormFields(([fields]) => fields[props.path || 'title'])
  const [touched, setTouched] = useState(false)
  const error = touched && !String(state?.value || '').trim() ? 'A form title is required.' : state?.errorMessage
  const access = useCollectionEditorAccess('forms', props.readOnly)
  return <EditorHeaderPortal slot="title"><div className="editor-header__title" onBlur={() => setTouched(true)}>
    <TextField {...props} readOnly={!access.canWrite(props.path || 'title')} field={{ ...props.field, admin: { ...props.field.admin, placeholder: 'Add title' } }} />
    {error && <p role="alert">{error}</p>}
  </div></EditorHeaderPortal>
}
