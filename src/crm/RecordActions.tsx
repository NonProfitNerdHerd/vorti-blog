'use client'
import { useConfig } from '@payloadcms/ui'
import { RecordAttachmentLink } from './RecordAttachmentLink'
import type { CRMRecordLink } from './record-model'

/** Keep record drafts intact while opening existing private record tools. */
export function RecordActions({ site, link }: { site: string; link: CRMRecordLink }) {
  const { config } = useConfig()
  const query = new URLSearchParams({
    site,
    view: 'record-tasks',
    recordType: link.type,
    recordID: link.id,
  })
  return (
    <div className="vc-crm-record-actions">
      <p>
        <a href={`${config.routes.admin}/crm?${query}`} target="_blank" rel="noopener noreferrer">
          Record follow-up tasks (opens in another tab)
        </a>
      </p>
      <RecordAttachmentLink site={site} link={link} />
    </div>
  )
}
