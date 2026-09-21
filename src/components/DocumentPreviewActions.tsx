'use client'

import { Button, useConfig, useDocumentInfo, useFormModified, useFormProcessing } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

export function DocumentPreviewActions() {
  const { collectionSlug, data, hasPublishedDoc, id, lastUpdateTime } = useDocumentInfo()
  const { config: { routes: { api } } } = useConfig()
  const modified = useFormModified()
  const processing = useFormProcessing()
  const [published, setPublished] = useState<{ key: string; url: string } | null>(null)
  const prefix = collectionSlug === 'posts' ? '/posts/' : '/'
  const publishedKey = `${collectionSlug}/${id}/${lastUpdateTime}`
  const publishedURL = hasPublishedDoc && published?.key === publishedKey ? published.url : null

  useEffect(() => {
    if (!id || !hasPublishedDoc) return
    const controller = new AbortController()
    // Read the published slug: a saved draft may already have a different slug.
    fetch(`${api}/${collectionSlug}/${encodeURIComponent(String(id))}?draft=false&depth=0&select[slug]=true&select[_status]=true`, {
      credentials: 'same-origin', signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() as Promise<{ _status?: string; slug?: string }> : null)
      .then((doc) => {
        if (!controller.signal.aborted && doc?._status === 'published' && typeof doc.slug === 'string' && doc.slug) {
          setPublished({ key: publishedKey, url: `${prefix}${encodeURIComponent(doc.slug)}` })
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [api, collectionSlug, hasPublishedDoc, id, prefix, publishedKey])

  const previewURL = `${prefix}${encodeURIComponent(data?.slug || '__preview__')}?livePreview=${encodeURIComponent(String(id))}`
  const needsSave = !id || modified

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      {publishedURL && (
        <Button el="anchor" url={publishedURL} newTab buttonStyle="secondary" size="small" margin={false}>
          View live
        </Button>
      )}
      <Button
        el={needsSave || processing ? 'button' : 'anchor'} url={needsSave || processing ? undefined : previewURL} newTab
        disabled={needsSave || processing} buttonStyle="secondary" size="small" margin={false}
        tooltip={needsSave ? 'Save a draft to preview your changes in a new tab.' : 'Preview the saved draft in a new tab.'}
      >
        Preview
      </Button>
      {needsSave && <small>Save a draft to preview changes.</small>}
    </div>
  )
}
