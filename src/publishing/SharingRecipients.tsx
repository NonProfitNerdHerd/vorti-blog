'use client'
import { useEffect, useState } from 'react'
import { useConfig, useField } from '@payloadcms/ui'
import { useAdminSite } from '../organizations/AdminSiteProvider'

export function SharingRecipients({ path }: { path: string }) {
  const { value, setValue } = useField<Array<string | number>>({ path })
  return <RecipientChoices group={path === 'publishingGroups'} value={value || []} setValue={setValue} />
}

export function RecipientChoices({ group, value, setValue }: { group: boolean; value: Array<string | number>; setValue: (value: Array<string | number>) => void }) {
  const { config } = useConfig()
  const { binding } = useAdminSite()
  const [choices, setChoices] = useState<Array<{ id: string | number; name: string }>>([])
  const [error, setError] = useState('')
  const site = binding?.site.id
  useEffect(() => {
    if (!site) return
    const controller = new AbortController()
    void fetch(`${config.routes.api}/publishing/readers?site=${encodeURIComponent(site)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw Error('Could not load sharing recipients.'); return response.json() as Promise<{ groups: Array<{ id: string; name: string }>; people: Array<{ id: number; name: string }> }> })
      .then(data => { if (!controller.signal.aborted) { setChoices(group ? data.groups : data.people); setError('') } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [config.routes.api, site, group])
  return <fieldset className="field-type"><legend>{group ? 'Sharing groups' : 'Named people'}</legend>
    {error && <p role="alert">{error}</p>}
    {!error && !choices.length && <p>No available {group ? 'groups' : 'people'}.</p>}
    {choices.map(choice => <label key={choice.id} style={{ display: 'block', marginBottom: '.5rem' }}>
      <input type="checkbox" checked={(value || []).includes(choice.id)} onChange={event => setValue(event.target.checked ? [...(value || []), choice.id] : (value || []).filter(id => id !== choice.id))} /> {choice.name}
    </label>)}
    <small>Sharing grants readership. Editing and publishing require separate permissions. An empty selection stays restricted.</small>
  </fieldset>
}
