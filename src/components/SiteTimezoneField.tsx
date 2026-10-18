'use client'
import { useEffect, useRef } from 'react'
import { TextField, useDocumentInfo, useField } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import { useSiteFormat } from '@design-system/payload-design-core/content'

/** Apply the site default once, only while initializing a new resource. */
export const SiteTimezoneField: TextFieldClientComponent = (props) => {
  const { id } = useDocumentInfo()
  const { value, setValue, formInitializing } = useField<string>({ path: props.path })
  const { timezone } = useSiteFormat()
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current || formInitializing) return
    initialized.current = true
    if (!id && (!value || value === 'UTC') && timezone) setValue(timezone, true)
  }, [id, value, setValue, timezone, formInitializing])
  return <TextField {...props} />
}
