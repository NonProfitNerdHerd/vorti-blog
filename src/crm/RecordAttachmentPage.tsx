'use client'
import { useState } from 'react'
import { Gutter, useConfig } from '@payloadcms/ui'
import { AttachmentWorkspace } from './AttachmentWorkspace'
import { crmRecordLink } from './record-model'

export function RecordAttachmentPage(props: {
  site: string
  type: string | null
  id: string | null
}) {
  return <RecordFiles key={`${props.site}:${props.type}:${props.id}`} {...props} />
}
function RecordFiles({ site, type, id }: { site: string; type: string | null; id: string | null }) {
  const { config } = useConfig(),
    [denied, setDenied] = useState('')
  let link
  try {
    link = crmRecordLink(type, id)
  } catch {
    return (
      <Gutter>
        <p role="alert">Choose a valid CRM record to open its private attachments.</p>
      </Gutter>
    )
  }
  return (
    <Gutter className="vc-crm">
      <h1>Private record attachments</h1>
      <p>
        This tab is pinned to the record and chapter in its address. Your original editor remains
        open.
      </p>
      <p>
        <a href={`${config.routes.admin}/crm?${new URLSearchParams({ site })}`}>
          Open CRM workspace
        </a>
      </p>
      {denied ? (
        <p role="alert">{denied}</p>
      ) : (
        <AttachmentWorkspace api={config.routes.api} site={site} link={link} onDenied={setDenied} />
      )}
    </Gutter>
  )
}
