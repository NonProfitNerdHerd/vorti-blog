'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ConfigProvider, DefaultListView, useConfig } from '@payloadcms/ui'
import type { ListViewClientProps } from 'payload'

/** Scope the area label to this list; the sidebar keeps the original collection labels. */
export function PublishingAreaList(props: ListViewClientProps) {
  const { config } = useConfig()
  const params = useSearchParams()
  const area = params.get('audience') === 'intranet' ? 'Intranet' : 'Public'
  const listConfig = useMemo(
    () => ({
      ...config,
      collections: config.collections.map((collection) => {
        if (collection.slug !== props.collectionSlug) return collection
        const plural = collection.labels.plural
        return {
          ...collection,
          labels: {
            ...collection.labels,
            plural:
              typeof plural === 'string'
                ? `${plural} (${area})`
                : Object.fromEntries(
                    Object.entries(plural).map(([locale, label]) => [locale, `${label} (${area})`]),
                  ),
          },
        }
      }),
    }),
    [config, props.collectionSlug, area],
  )

  return (
    <ConfigProvider config={listConfig}>
      <DefaultListView {...props} />
    </ConfigProvider>
  )
}
