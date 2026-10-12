'use client'
import { useEffect, useRef, useState } from 'react'
import { UploadInput, useConfig } from '@payloadcms/ui'
import type { BlockPresentation } from '../blocks/presentation'

export function BackgroundMediaPicker({
  value,
  change,
}: {
  value: BlockPresentation['background']
  change: (value: NonNullable<BlockPresentation['background']>) => void
}) {
  const { config } = useConfig()
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  return (
    <>
      <UploadInput
        api={config.routes.api}
        serverURL={config.serverURL}
        relationTo="media"
        path="block-background-media"
        label="Background image"
        allowCreate
        showError={false}
        value={value?.mediaID as never}
        onChange={async (selected) => {
          const current = ++request.current
          if (!selected) {
            change({ mediaID: undefined, imageURL: '' })
            return
          }
          const id = typeof selected === 'object' && 'id' in selected ? selected.id : selected
          try {
            const response = await fetch(
              `${config.serverURL ?? ''}${config.routes.api}/media/${encodeURIComponent(String(id))}`,
              { credentials: 'same-origin' },
            )
            if (!response.ok) throw new Error('Unable to load the selected image.')
            const media = (await response.json()) as { url?: string }
            if (current !== request.current) return
            if (!media.url) throw new Error('The selected media has no image URL.')
            change({ mediaID: id as string | number, imageURL: media.url })
            setError('')
          } catch (error) {
            if (current !== request.current) return
            setError(error instanceof Error ? error.message : 'Unable to load image.')
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
    </>
  )
}
