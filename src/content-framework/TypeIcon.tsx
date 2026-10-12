'use client'
import { usePostTypeAccess } from './usePostTypeAccess'
import { useField } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import { PostTypeIconPicker } from '@design-system/payload-design-core/admin'
export const TypeIcon: TextFieldClientComponent = ({ path, readOnly: inheritedReadOnly }) => {
  const access = usePostTypeAccess(inheritedReadOnly)
  const readOnly = !access.canWrite(path)
  const { value = 'document', setValue } = useField<string>({ path })
  return <PostTypeIconPicker value={value} onChange={setValue} disabled={readOnly} />
}
