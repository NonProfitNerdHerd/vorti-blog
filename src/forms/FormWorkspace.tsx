'use client'
import { useConfig, useDocumentInfo, useField, useForm, useLocale } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useContext, useEffect, useMemo, useState } from 'react'
import { FormTransferHost } from './FormTransferHost'
import type { JSONFieldClientComponent } from 'payload'
import type { FormDefinition } from '@design-system/payload-design-core/forms'
import { FormBuilder, type PaymentAvailability } from '@design-system/payload-design-core/forms/client'
import { FormSharing } from './FormSharing'
import { legacyDefinition } from './legacy'
import { useCollectionEditorAccess } from '../content-framework/usePostTypeAccess'


export const FormWorkspace: JSONFieldClientComponent = ({ path, readOnly }) => {
  const transferTarget = useContext(FormTransferHost)
  const { value, setValue, errorMessage, showError } = useField<FormDefinition>({ path })
  const { id, data, hasPublishedDoc } = useDocumentInfo()
  const access = useCollectionEditorAccess('forms', readOnly)
  const { submit } = useForm()
  const { config } = useConfig()
  const locale = useLocale()
  const draftAction = formatAdminURL({ apiRoute: config.routes.api, path: `/forms${id ? `/${id}` : ''}?${new URLSearchParams({ draft: 'true', depth: '0', 'fallback-locale': 'null', ...(locale?.code ? { locale: locale.code } : {}) })}` })
  const fallback = useMemo(() => legacyDefinition(data || {}), [data])
  const permitted = access.canWrite(path)
  const [postTypes, setPostTypes] = useState<{ id: string; label: string }[]>([])
  const [payments, setPayments] = useState<PaymentAvailability>()
  const [delivery, setDelivery] = useState<{ local: boolean; emailConfigured: boolean; integrations: { id: string; label: string; provider: string; configured: boolean }[] }>()
  const [resources, setResources] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/forms-actions/options', { signal: controller.signal }).then(async response => { if (response.ok) setDelivery(await response.json()) }).catch(() => {})
    fetch('/api/forms-cms/options', { signal: controller.signal }).then(async response => { if (response.ok) { const result = await response.json() as { postTypes: { id: string; label: string }[] }; setPostTypes(result.postTypes) } }).catch(() => {})
    fetch('/api/forms-payments/config', { signal: controller.signal }).then(async response => { if (response.ok) setPayments(await response.json()) }).catch(() => {})
    fetch('/api/form-resources?limit=100&depth=0', { signal: controller.signal }).then(async response => {
      if (!response.ok) return
      const result = await response.json() as { docs: { id: number; label?: string }[] }
      setResources(result.docs.map(resource => ({ id: String(resource.id), label: resource.label || `Resource ${resource.id}` })))
    }).catch(() => {})
    return () => controller.abort()
  }, [])
  return <>
    {showError && <p role="alert">{String(errorMessage)}</p>}
    <FormBuilder transferTarget={transferTarget} value={value || fallback} onChange={setValue} readOnly={!permitted} resources={resources} payments={payments} postTypes={postTypes} integrations={delivery?.integrations} local={delivery?.local}
      saveStatus={hasPublishedDoc ? 'Draft changes do not alter your published form.' : 'Not yet published'}
      onSave={() => void submit({ action: draftAction, method: id ? 'PATCH' : 'POST', overrides: { _status: 'draft' }, skipValidation: true })}
      onPublish={() => void submit({ overrides: { _status: 'published' } })}>
      {id ? <FormSharing formID={id} published={data?.publishedRevision} /> : <p>Save and publish this form to create its share link, QR code, and embed code.</p>}
    </FormBuilder>
  </>
}
