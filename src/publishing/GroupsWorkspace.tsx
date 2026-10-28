'use client'
import { useEffect, useState } from 'react'
import { useConfig } from '@payloadcms/ui'

type Group = { id: string; name: string; retired: number; revision: number; members: number[] }
type Result = { authorityRevision: number; groups: Group[] }
export function GroupsWorkspace({ site, initial }: { site: string; initial: Result }) {
  const { config } = useConfig(), api = config.routes.api
  const [result, setResult] = useState(initial), [group, setGroup] = useState<Group | null>(null)
  const [people, setPeople] = useState<Array<{ id: number; name: string }>>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [baseline, setBaseline] = useState('')
  const dirty = Boolean(group && JSON.stringify(group) !== baseline)
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [dirty])
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`${api}/publishing/readers?site=${encodeURIComponent(site)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw Error('Could not load eligible members.'); return response.json() as Promise<{ people: Array<{ id: number; name: string }> }> })
      .then(data => { if (!controller.signal.aborted) setPeople(data.people) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [api, site])
  function select(value: Group) {
    if (dirty && !window.confirm('Discard unsaved sharing group changes?')) return
    setGroup(structuredClone(value)); setBaseline(JSON.stringify(value)); setError(''); setMessage('')
  }
  async function save(retired = false) {
    if (!group || busy) return
    if (retired && !window.confirm('Retire this group and immediately revoke the readership it grants?')) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`${api}/publishing/groups?site=${encodeURIComponent(site)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: group.id, name: group.name, retired, members: group.members, expectedAuthorityRevision: result.authorityRevision, key: crypto.randomUUID() }) })
      if (!response.ok) throw Error(response.status === 409 ? 'Group or permissions changed. Reload the current policy before saving; your draft is retained.' : 'The group could not be saved. Review its members and your permissions.')
      const refreshed = await fetch(`${api}/publishing/groups?site=${encodeURIComponent(site)}`, { cache: 'no-store' })
      if (!refreshed.ok) throw Error('Saved. Reload to check current groups.')
      const current = await refreshed.json() as Result
      setResult(current)
      const saved = current.groups.find(item => item.id === group.id) || null
      setGroup(saved); setBaseline(JSON.stringify(saved)); setMessage(retired ? 'Group retired; its readership grants are revoked.' : 'Sharing group saved.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the group.') }
    finally { setBusy(false) }
  }
  return <main style={{ padding: '2rem', maxWidth: '70rem', margin: '0 auto' }}><h1>Intranet sharing groups</h1>
    <p>Groups grant readership within this site. Editing, publishing, and administration remain separate permissions.</p>
    <button type="button" onClick={() => select({ id: crypto.randomUUID(), name: '', retired: 0, revision: 0, members: [] })}>New sharing group</button>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', marginTop: '1.5rem' }}>
      <nav style={{ flex: '1 1 12rem' }} aria-label="Sharing groups">{result.groups.map(item => <button style={{ display: 'block', marginBottom: '.5rem' }} key={item.id} onClick={() => select(item)}>{item.name}{item.retired ? ' (retired)' : ''}</button>)}</nav>
      {group && <form style={{ flex: '3 1 22rem', minWidth: 0 }} onSubmit={event => { event.preventDefault(); void save(false) }}><fieldset disabled={busy}>
        <label>Group name<input required maxLength={120} value={group.name} onChange={event => setGroup({ ...group, name: event.target.value })} /></label>
        <fieldset><legend>Members</legend>{people.map(person => <label key={person.id} style={{ display: 'block', marginBlock: '.5rem' }}><input type="checkbox" checked={group.members.includes(person.id)} onChange={event => setGroup({ ...group, members: event.target.checked ? [...group.members, person.id] : group.members.filter(id => id !== person.id) })} /> {person.name}</label>)}
          {group.members.filter(id => !people.some(person => person.id === id)).map(id => <p key={id}>Unavailable member #{id} <button type="button" onClick={() => setGroup({ ...group, members: group.members.filter(member => member !== id) })}>Remove</button></p>)}
        </fieldset>
        <button type="submit" disabled={(!dirty && !group.retired) || !group.name.trim()}>{busy ? 'Saving…' : group.retired ? 'Reactivate group' : 'Save group'}</button>
        {!group.retired && result.groups.some(item => item.id === group.id) && <button type="button" onClick={() => void save(true)}>Retire group</button>}
      </fieldset></form>}
    </div>
  </main>
}
