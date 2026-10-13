'use client'
import { useDocumentInfo, useField } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'

export const LocalDeliveryMessage: TextFieldClientComponent = ({ path }) => {
  const { id } = useDocumentInfo()
  const { value } = useField<string>({ path })
  return <section aria-label="Captured local message"><h2>Local message capture</h2><p>No external delivery occurred.</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</pre>{id && <a href={`/api/forms-deliveries/${encodeURIComponent(String(id))}/message`} target="_blank" rel="noopener noreferrer">Open protected message</a>}</section>
}
