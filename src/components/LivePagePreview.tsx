'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
import type { Page } from '@/payload-types'
import { PageArticle } from './PageArticle'

export function LivePagePreview({ initialData }: { initialData: Page }) {
  const { data } = useLivePreview<Page>({
    initialData,
    serverURL: typeof window === 'undefined' ? '' : window.location.origin,
    depth: 1,
  })
  return <PageArticle page={data} />
}
