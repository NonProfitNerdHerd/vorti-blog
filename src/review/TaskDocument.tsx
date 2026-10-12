'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Reset the panel on document navigation and load its remote task count. */
import { useConfig, useDocumentInfo } from '@payloadcms/ui'
import { DocumentReviewPanel } from '@design-system/payload-design-core/admin'
import { useCallback, useEffect, useState } from 'react'
import { Tasks } from './Tasks'
import { query, reviewAPI } from './client'
import './tasks.css'

export function TaskDocument() {
  const { collectionSlug, id, isInitializing } = useDocumentInfo()
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const refresh = useCallback(async () => {
    if (!id) return
    const result = await reviewAPI<{ totalDocs: number }>(
      api,
      `review-tasks?${query({ and: [{ documentType: { equals: collectionSlug } }, { documentID: { equals: String(id) } }, { archived: { not_equals: true } }, { status: { not_equals: 'done' } }] }, { limit: '1' })}`,
    )
    setCount(result.totalDocs)
  }, [api, collectionSlug, id])
  useEffect(() => {
    setOpen(new URLSearchParams(location.search).has('task'))
    setCount(0)
    void refresh().catch(() => {})
  }, [refresh])
  return (
    <DocumentReviewPanel count={count} open={open} onOpenChange={setOpen} disabled={isInitializing}>
      {id ? (
        <Tasks
          key={`${collectionSlug}:${id}`}
          document={{ type: collectionSlug!, id: String(id) }}
          onChange={refresh}
        />
      ) : (
        <p>Save this document before adding tasks.</p>
      )}
    </DocumentReviewPanel>
  )
}
