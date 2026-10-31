'use client'
import { useConfig } from '@payloadcms/ui'
import type { CRMRecordLink } from './record-model'

export function RecordTaskLink({ site, link, task, label = 'Tasks' }: { site: string; link?: CRMRecordLink; task?: string; label?: string }) {
  const { config } = useConfig()
  const href = task
    ? `${config.routes.admin}/collections/review-tasks?${new URLSearchParams({ site, task })}`
    : link ? `${config.routes.admin}/crm?${new URLSearchParams({ site, view: 'record-tasks', recordType: link.type, recordID: link.id })}` : ''
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{task ? 'Open task' : label}</a> : null
}
