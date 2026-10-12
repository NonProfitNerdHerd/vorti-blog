'use client'
import { useAuth, useDocumentInfo } from '@payloadcms/ui'

/** Presentational rows do not inherit collection write permissions automatically. */
export function usePostTypeAccess(readOnly?: boolean) {
  const { permissions } = useAuth()
  const { id, docPermissions, documentIsLocked } = useDocumentInfo()
  const access = docPermissions || permissions?.collections?.['post-types']
  const operation = id ? 'update' : 'create'
  const writable =
    !readOnly &&
    !documentIsLocked &&
    !!access &&
    (id ? access.update === true : 'create' in access && access.create === true)
  const fields = access?.fields
  const canWrite = (name: string) => {
    const field = fields === true ? true : fields?.[name]
    return writable && (field === true || field?.[operation] === true)
  }
  return { writable, fields, canWrite }
}
