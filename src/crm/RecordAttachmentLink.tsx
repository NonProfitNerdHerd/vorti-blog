'use client'
import { useConfig } from '@payloadcms/ui'
import type { CRMRecordLink } from './record-model'

/** A separate, explicitly scoped tab keeps the source editor and its drafts intact. */
export function RecordAttachmentLink({ site, link }: { site: string; link: CRMRecordLink }) {
  const { config } = useConfig()
  const query = new URLSearchParams({
    site,
    view: 'attachments',
    recordType: link.type,
    recordID: link.id,
  })
  return (
    <p>
      <a href={`${config.routes.admin}/crm?${query}`} target="_blank" rel="noopener noreferrer">
        Private record attachments (opens in another tab)
      </a>
    </p>
  )
}
