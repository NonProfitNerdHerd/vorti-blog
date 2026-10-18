'use client'
import { useEffect, useRef } from 'react'
import { useAuth, useDocumentInfo, useField, useFormFields } from '@payloadcms/ui'
import type { SelectFieldClientComponent } from 'payload'
import './user-attribution.css'

export const AttributionPreference: SelectFieldClientComponent = ({ path, readOnly }) => {
  const { value, setValue, showError, errorMessage } = useField<string | null>({ path })
  const username = useFormFields(([fields]) => fields.username?.value as string | undefined)
  const email = useFormFields(([fields]) => fields.email?.value as string | undefined)
  const { savedDocumentData, id } = useDocumentInfo()
  const { user, fetchFullUser } = useAuth()
  const saved = JSON.stringify([
    savedDocumentData?.username,
    savedDocumentData?.email,
    savedDocumentData?.attributionPreference,
  ])
  const previous = useRef(saved)
  useEffect(() => {
    if (previous.current === saved) return
    previous.current = saved
    window.dispatchEvent(new Event('vorti-user-identity-saved'))
    if (String(id) !== String(user?.id)) return
    void fetchFullUser()
  }, [saved, id, user?.id, fetchFullUser])
  const chosen = value || (!id ? 'username' : '')
  return (
    <div className="field-type select" style={{ marginBottom: 24, overflowWrap: 'anywhere' }}>
      <label className="field-label" htmlFor="attribution-choice">
        Display as
      </label>
      <select
        id="attribution-choice"
        value={chosen}
        disabled={Boolean(readOnly)}
        onChange={(event) => setValue(event.target.value || null)}
        style={{
          width: '100%',
          padding: 12,
          borderRadius: 6,
          background: 'var(--theme-input-bg)',
          color: 'var(--theme-text)',
          border: '1px solid var(--theme-elevation-300)',
        }}
      >
        {id && !savedDocumentData?.attributionPreference && (
          <option value="">Keep current attribution (legacy)</option>
        )}
        <option value="username">Username</option>
        <option value="email">Email (publicly visible)</option>
      </select>
      <p aria-live="polite">
        {chosen ? (
          <>
            Attribution preview:{' '}
            <strong>{(chosen === 'email' ? email : username) || 'Enter a username'}</strong>
          </>
        ) : (
          'Your existing labels and visibility will remain unchanged until you choose.'
        )}
      </p>
      <p className="field-description">
        Your choice applies to previous and future linked posts, tasks, and comments. Email is
        publicly visible when selected. Your public bio/profile page remains optional.
      </p>
      {showError && <p role="alert">{errorMessage}</p>}
    </div>
  )
}
