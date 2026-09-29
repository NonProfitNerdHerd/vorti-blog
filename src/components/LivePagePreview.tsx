'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
import type { Page } from '@/payload-types'
import type { PostDesignSection } from '@/lib/post-design'
import { useEffect, useState } from 'react'
import { PageArticle } from './PageArticle'

export function LivePagePreview({ initialData, initialDesignSections = [] }: { initialData: Page; initialDesignSections?: PostDesignSection[] }) {
  const { data } = useLivePreview<Page>({
    initialData,
    serverURL: typeof window === 'undefined' ? '' : window.location.origin,
    depth: 1,
  })
  const [sections, setSections] = useState(initialDesignSections)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch('/api/content-design-preview', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.resolve([]))
        .then((result) => { if (!controller.signal.aborted) setSections(Array.isArray(result) ? result : []) })
        .catch(() => {})
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [data])
  return <PageArticle page={data} designSections={sections} />
}
