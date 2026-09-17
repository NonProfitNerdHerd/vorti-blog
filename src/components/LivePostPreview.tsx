'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
import type { Post } from '@/payload-types'
import { PostArticle } from './PostArticle'

export function LivePostPreview({ initialData }: { initialData: Post }) {
  const { data } = useLivePreview<Post>({
    initialData,
    serverURL: typeof window === 'undefined' ? '' : window.location.origin,
    depth: 2,
  })
  return <PostArticle post={data} />
}
