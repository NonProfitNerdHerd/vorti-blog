'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Load the gift's explicit chapter attribution. */
import { useEffect, useRef, useState } from 'react'
import { ClassificationPicker } from './ClassificationPicker'
import { crmRead } from './HouseholdWorkspace'
type Attribution = {
  campaign_id: string | null
  appeal_id: string | null
  campaign_name: string | null
  appeal_name: string | null
  revision: number
}
export function GiftAttribution({
  api,
  site,
  gift,
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  gift: string
  onDirty: (dirty: boolean) => void
  onSaving: (busy: boolean) => void
}) {
  const [doc, setDoc] = useState<Attribution | null>(null),
    [canEdit, setCanEdit] = useState(false),
    [campaign, setCampaign] = useState(''),
    [appeal, setAppeal] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const operation = useRef<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setDoc(null)
    void crmRead<{ doc: Attribution; canEdit: boolean }>(
      `${api}/crm/fundraising?kind=campaigns&site=${encodeURIComponent(site)}&gift=${encodeURIComponent(gift)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        setDoc(data.doc)
        setCanEdit(data.canEdit)
        setCampaign(data.doc.campaign_id || '')
        setAppeal(data.doc.appeal_id || '')
        setReason('')
        setError('')
        operation.current = null
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message)
      })
    return () => controller.abort()
  }, [api, site, gift])
  const changed = () => {
    onDirty(true)
    operation.current = null
  }
  const save = async () => {
    if (!doc || busy) return
    operation.current ||= crypto.randomUUID()
    setBusy(true)
    onSaving(true)
    setError('')
    try {
      await crmRead(`${api}/crm/fundraising`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site,
          gift,
          campaign: campaign || null,
          appeal: appeal || null,
          expectedRevision: doc.revision,
          reason,
          operationKey: operation.current,
          action: 'attribute',
        }),
      })
      const result = await crmRead<{ doc: Attribution }>(
        `${api}/crm/fundraising?kind=campaigns&site=${encodeURIComponent(site)}&gift=${encodeURIComponent(gift)}`,
      )
      setDoc(result.doc)
      setReason('')
      operation.current = null
      onDirty(false)
    } catch (cause) {
      setError((cause as Error).message)
      if ([401, 403].includes((cause as { status: number }).status)) {
        setDoc(null)
        setCanEdit(false)
      }
    } finally {
      setBusy(false)
      onSaving(false)
    }
  }
  return (
    <section>
      <h4>Campaign and appeal</h4>
      {error && <p role="alert">{error}</p>}
      {doc && (
        <>
          <p>
            Campaign: {doc.campaign_name || 'None'} · Appeal: {doc.appeal_name || 'None'}
          </p>
          {canEdit && (
            <fieldset disabled={busy}>
              <legend>Change attribution</legend>
              <p>
                Archived classifications remain on historical gifts. Choose a replacement only when
                correcting attribution.
              </p>
              <ClassificationPicker
                api={api}
                site={site}
                kind="campaigns"
                value={campaign}
                onChange={(value) => {
                  setCampaign(value)
                  changed()
                }}
              />
              <ClassificationPicker
                api={api}
                site={site}
                kind="appeals"
                value={appeal}
                onChange={(value) => {
                  setAppeal(value)
                  changed()
                }}
              />
              <label>
                Attribution change reason
                <textarea
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value)
                    changed()
                  }}
                />
              </label>
              <button type="button" disabled={!reason.trim()} onClick={() => void save()}>
                Save attribution
              </button>
            </fieldset>
          )}
        </>
      )}
    </section>
  )
}
