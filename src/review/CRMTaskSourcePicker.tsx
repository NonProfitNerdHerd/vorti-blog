'use client'
import { useEffect, useState } from 'react'
import { crmRecordTypes, type CRMRecordType } from '../crm/record-model'

export type CRMTaskSource = { site: string; type: CRMRecordType; id: string; label: string; revision: number; authorityRevision: number }
const names: Record<CRMRecordType, string> = {
  contact: 'Contact or organization', household: 'Household', gift: 'Donation', pledge: 'Pledge', recurring: 'Recurring commitment', membership: 'Membership term', opportunity: 'Opportunity', 'volunteer-activity': 'Volunteer activity', campaign: 'Campaign', appeal: 'Appeal', fund: 'Fund', 'volunteer-invitation': 'Volunteer invitation', 'volunteer-participation': 'Volunteer participation', 'volunteer-hours': 'Volunteer hours', 'correspondence-document': 'Correspondence document', 'correspondence-batch': 'Correspondence batch', 'import-run': 'Import run',
}
export function crmTaskSourceLabel(type: CRMRecordType) { return names[type] }
export function crmTaskSourceHref(admin: string, site: string, type: CRMRecordType, id: string) {
  const location: Record<string, Record<string, string>> = {
    household: { view: 'households', household: id },
    gift: { view: 'donations', result: id },
    pledge: { view: 'giving', resultType: 'pledge', result: id },
    recurring: { view: 'giving', resultType: 'recurring', result: id },
    membership: { view: 'memberships', result: id },
    opportunity: { view: 'opportunities', result: id },
    'volunteer-activity': { view: 'volunteers', volunteerView: 'activities', result: id },
    campaign: { view: 'fundraising', resultType: 'campaigns', result: id },
    appeal: { view: 'fundraising', resultType: 'appeals', result: id },
    fund: { view: 'fundraising', resultType: 'funds', result: id },
    'volunteer-hours': { view: 'volunteers', volunteerView: 'hours', result: id },
  }
  return `${admin}/crm?${new URLSearchParams({ site, ...(location[type] || { view: 'record-tasks', recordType: type, recordID: id }) })}`
}
export function CRMTaskSourcePicker({ api, site, value, onChange }: { api: string; site: string; value: CRMTaskSource | null; onChange: (value: CRMTaskSource | null) => void }) {
  const [type, setType] = useState<CRMRecordType>('contact')
  const [search, setSearch] = useState('')
  const [docs, setDocs] = useState<CRMTaskSource[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    if (!site) return () => controller.abort()
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ site, type, search })
      void fetch(`${api}/crm/tasks/records?${query}`, { credentials: 'same-origin', signal: controller.signal })
        .then(async response => {
          const data = await response.json() as { docs?: Omit<CRMTaskSource, 'site' | 'type'>[]; message?: string }
          if (!response.ok) throw Object.assign(new Error(data.message || 'Unable to load VortiCause records.'), { status: response.status })
          return data.docs || []
        })
        .then(rows => { if (!controller.signal.aborted) { setDocs(rows.map(row => ({ ...row, site, type }))); setError('') } })
        .catch(cause => { if (!controller.signal.aborted) { setDocs([]); setError(cause.status === 403 ? 'You cannot link records of this type in the selected site.' : cause.message) } })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [api, site, type, search])
  return <div className="task-crm-source-picker">
    <label>VortiCause source
      <select value={value ? 'linked' : ''} onChange={event => { if (!event.target.value) onChange(null) }}>
        <option value="">No linked record</option>{value && <option value="linked">{names[value.type]} · {value.label}</option>}
      </select>
    </label>
    {!value && <><label>Record type<select value={type} onChange={event => { setType(event.target.value as CRMRecordType); setDocs([]) }}>{crmRecordTypes.map(key => <option key={key} value={key}>{names[key]}</option>)}</select></label>
      <label>Find a record<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search this site" /></label>
      <div className="task-crm-source-results" role="listbox" aria-label="Available VortiCause records">{docs.map(row => <button type="button" role="option" aria-selected={false} key={row.id} onClick={() => onChange(row)}>{row.label}</button>)}</div>
      {error && <p role="alert">{error}</p>}
    </>}
  </div>
}
