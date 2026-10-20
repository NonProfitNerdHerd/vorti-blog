'use client'
import { useAuth, useDocumentInfo } from '@payloadcms/ui'
import { allowsOperation } from './permission-value'

/** Presentational rows do not inherit collection write permissions automatically. */
export function useCollectionEditorAccess(collection: string, readOnly?: boolean) {
  const { permissions, user } = useAuth()
  const { id, docPermissions, documentIsLocked, currentEditor, hasSavePermission } = useDocumentInfo()
  const editorID = typeof currentEditor === 'object' ? currentEditor?.id : currentEditor
  // Payload also sets this flag for our own editing session, even before first save.
  const lockedByAnother =
    !!id && documentIsLocked && editorID != null && String(editorID) !== String(user?.id)
  const access = docPermissions || permissions?.collections?.[collection]
  const operation = id ? 'update' : 'create'
  const writable =
    !readOnly &&
    !lockedByAnother &&
    !!access &&
    hasSavePermission !== false &&
    (id ? allowsOperation(access.update) : 'create' in access && allowsOperation(access.create))
  const fields = access?.fields
  const canWrite = (name: string) => {
    const field = fields === true ? true : fields?.[name]
    return writable && (field === true || allowsOperation(field?.[operation]))
  }
  return { writable, fields, canWrite }
}
