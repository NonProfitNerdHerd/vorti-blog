'use client'
import { useEffect } from 'react'
import { useDocumentInfo, useField } from '@payloadcms/ui'

export function AudienceField() {
  const { id } = useDocumentInfo()
  const { value, setValue } = useField<string>({ path: 'audience' })
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!id) {
      const selected = url.searchParams.get('audience') === 'intranet' ? 'intranet' : 'public'
      if (value !== selected) setValue(selected)
    } else if (value === 'public' || value === 'intranet') {
      if (url.searchParams.get('audience') !== value) {
        url.searchParams.set('audience', value)
        window.history.replaceState(window.history.state, '', url)
      }
    }
  }, [id, value, setValue])
  return <div className="field-type"><strong>{value === 'intranet' ? 'Intranet' : 'Public'}</strong>
    <p>{value === 'intranet' ? 'Available only to permitted, signed-in readers.' : 'Published content is available on the public website.'}</p>
    <small>Use Copy or Move to change publishing area.</small>
  </div>
}
