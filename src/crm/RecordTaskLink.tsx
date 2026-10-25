'use client'
import { useConfig } from '@payloadcms/ui'

export function RecordTaskLink({ site, task }: { site: string; task: string }) {
  const { config } = useConfig()
  return (
    <a
      href={`${config.routes.admin}/collections/review-tasks?${new URLSearchParams({ site, task })}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      Open follow-up task (opens in another tab)
    </a>
  )
}
