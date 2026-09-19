'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
import { useEffect, useState } from 'react'
import type { Post } from '@/payload-types'
import type { PostDesignSection } from '@/lib/post-design'
import { PostArticle } from './PostArticle'

export function LivePostPreview({ initialData, initialDesignSections = [] }: { initialData: Post; initialDesignSections?: PostDesignSection[] }) {
  const { data } = useLivePreview<Post>({
    initialData,
    serverURL: typeof window === 'undefined' ? '' : window.location.origin,
    depth: 2,
  })
  const [sections, setSections] = useState(initialDesignSections)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch('/api/post-design-preview', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.resolve([]))
        .then((result) => { if (!controller.signal.aborted) setSections(Array.isArray(result) ? result : []) })
        .catch(() => {})
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [data])
  return <PostArticle post={data} designSections={sections} />
}
