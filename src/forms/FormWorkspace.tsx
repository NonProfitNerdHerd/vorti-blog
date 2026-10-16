'use client'
import { useConfig, useDocumentInfo, useField, useForm, useLocale } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { createPortal } from 'react-dom'
import { useContext, useEffect, useMemo, useState } from 'react'
import { FormEmailHost, FormTransferHost } from './FormTransferHost'
import type { JSONFieldClientComponent } from 'payload'
import type { FormDefinition } from '@design-system/payload-design-core/forms'
import { FormBuilder, type PaymentAvailability } from '@design-system/payload-design-core/forms/client'
import { FormSharing } from './FormSharing'
import { prepareStoredForm, type ReviewedDefinition } from './legacy'
import { useCollectionEditorAccess } from '../content-framework/usePostTypeAccess'


export const FormWorkspace: JSONFieldClientComponent = ({ path, readOnly }) => {
  const emailHost = useContext(FormEmailHost)
  const transferTarget = useContext(FormTransferHost)
  const { value, setValue, errorMessage, showError } = useField<FormDefinition>({ path })
  const { id, data, hasPublishedDoc } = useDocumentInfo()
  const access = useCollectionEditorAccess('forms', readOnly)
  const { submit } = useForm()
  const { config } = useConfig()
  const locale = useLocale()
  const draftAction = formatAdminURL({ apiRoute: config.routes.api, path: `/forms${id ? `/${id}` : ''}?${new URLSearchParams({ draft: 'true', depth: '0', 'fallback-locale': 'null', ...(locale?.code ? { locale: locale.code } : {}) })}` })
  const legacy = useMemo(() => prepareStoredForm(data || {}), [data])
  const fallback = legacy.definition
  const working = value ? prepareStoredForm({ ...data, definition: value }).definition : fallback
  const needsReview = legacy.issues.length > 0
  const reviewed = legacy.issues.every(issue => Array.isArray(working.legacyReview) && working.legacyReview.includes(issue.message))
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
  const review = (area: 'fields' | 'email') => needsReview && legacy.issues.some(issue => issue.area === area) ? <section className="forms-legacy-review" aria-label={area === 'email' ? 'Legacy email review' : 'Legacy field review'}><h3>Review older {area === 'email' ? 'email settings' : 'form settings'}</h3><p>The original settings remain stored. These differences need review before conversion can be saved.</p><ul>{legacy.issues.filter(issue => issue.area === area).map(issue => <li key={issue.message}>{issue.message}</li>)}</ul>{area === 'fields' && emailHost && legacy.issues.some(issue => issue.area === 'email') && <button type="button" onClick={emailHost.open}>Review Email settings</button>}</section> : null
  return <>
    {showError && <p role="alert">{String(errorMessage)}</p>}
    {review('fields')}
    {needsReview && <div className="forms-legacy-review"><label><input type="checkbox" disabled={!permitted} checked={reviewed} onChange={event => setValue({ ...working, legacyReview: event.target.checked ? legacy.issues.map(issue => issue.message) : [] } as ReviewedDefinition)} />I have reviewed the conversion differences in Primary and Email. Keep the original settings for reference.</label><details><summary>Original settings (read only)</summary><pre>{JSON.stringify({ fields: data?.fields, emails: data?.emails, confirmationMessage: data?.confirmationMessage, redirect: data?.redirect }, null, 2)}</pre></details></div>}
    {emailHost?.target && createPortal(<>{showError && <p role="alert">{String(errorMessage)}</p>}{review('email')}{needsReview && <p>Return to Primary to acknowledge the conversion differences before saving.</p>}</>, emailHost.target)}
    <FormBuilder emailTarget={emailHost?.target} onEmailIssue={emailHost?.open} transferTarget={transferTarget} value={working} onChange={setValue} readOnly={!permitted} resources={resources} payments={payments} postTypes={postTypes} integrations={delivery?.integrations} local={delivery?.local}
      saveStatus={hasPublishedDoc ? 'Draft changes do not alter your published form.' : 'Not yet published'}
      onSave={() => void submit({ action: draftAction, method: id ? 'PATCH' : 'POST', overrides: { _status: 'draft' }, skipValidation: true })}
      onPublish={() => void submit({ overrides: { _status: 'published' } })}>
      {id ? <FormSharing formID={id} published={data?.publishedRevision} /> : <p>Save and publish this form to create its share link, QR code, and embed code.</p>}
    </FormBuilder>
  </>
}
