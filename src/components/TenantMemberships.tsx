'use client'
import { useEffect, useState } from 'react'

type Directory = {
  revision: number
  members: { id: number; email: string; active: number }[]
  assignments: {
    id: string
    user: number
    roleName: string
    site: string | null
    descendants: number
    retired: number
  }[]
  scopes: string[]
  tenantScope: boolean
}
export function TenantMemberships({
  api,
  site,
  roles,
}: {
  api: string
  site: string
  roles: { id: string; name: string; builtin: string | null; retired: number }[]
}) {
  const [directory, setDirectory] = useState<Directory | null>(null)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [user, setUser] = useState(''),
    [role, setRole] = useState('')
  const [scope, setScope] = useState(site),
    [descendants, setDescendants] = useState(false)
  const [email,setEmail]=useState(''),[invitationLink,setInvitationLink]=useState('')
  const load = async () => {
    const response = await fetch(
      `${api}/tenant-settings?site=${encodeURIComponent(site)}&section=members`,
      { cache: 'no-store' },
    )
    if (!response.ok) throw Error('Memberships are unavailable for this scope.')
    setDirectory(await response.json())
  }
  useEffect(() => {
    const controller=new AbortController()
    fetch(`${api}/tenant-settings?site=${encodeURIComponent(site)}&section=members`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{if(!response.ok)throw Error('Memberships are unavailable for this scope.');return response.json() as Promise<Directory>})
      .then(setDirectory).catch(cause=>{if(!controller.signal.aborted)setError(cause.message)})
    return()=>controller.abort()
  }, [api, site])
  const mutate = async (data: Record<string, unknown>) => {
    if (!directory || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${api}/tenant-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          site,
          expectedRevision: directory.revision,
          operationKey: crypto.randomUUID(),
        }),
      })
      if (!response.ok) {
        const value = (await response.json()) as { message?: string }
        throw Error(
          response.status === 409
            ? 'Memberships changed. Reload before trying again.'
            : value.message || 'Membership change was rejected.',
        )
      }
      const result=await response.json() as {link?:string}
      if(data.action==='invite' && result.link)setInvitationLink(result.link)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Membership change failed.')
    } finally {
      setBusy(false)
    }
  }
  const selectedRole = roles.find((item) => item.id === role)
  return (
    <section aria-label="Tenant memberships">
      <h3>Memberships and assignments</h3>
      <p>
        Membership suspension applies only to this tenant. Shared account credentials remain
        controlled by the account holder.
      </p>
      {directory && (
        <>
          {directory.tenantScope && <form onSubmit={event=>{event.preventDefault();void mutate({action:'invite',email})}}>
            <label>Invite by email<input required type="email" value={email} onChange={event=>setEmail(event.target.value)}/></label>
            <button disabled={busy}>Create single-use invitation</button>
            {invitationLink&&<label>Share this invitation with the intended recipient. It expires in seven days.<input readOnly value={invitationLink} onFocus={event=>event.target.select()}/></label>}
          </form>}
          <table className="system-settings-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Status</th>
                <th>Assignments</th>
              </tr>
            </thead>
            <tbody>
              {directory.members.map((member) => (
                <tr key={member.id}>
                  <th scope="row">{member.email}</th>
                  <td>
                    {member.active ? 'Active' : 'Suspended'}{' '}
                    {directory.tenantScope && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void mutate({
                            action: 'member-active',
                            user: member.id,
                            active: !member.active,
                          })
                        }
                      >
                        {member.active ? 'Suspend' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                  <td>
                    {directory.assignments
                      .filter((item) => item.user === member.id)
                      .map((item) => (
                        <div key={item.id}>
                          {item.roleName} · {item.site || 'Tenant'}
                          {item.descendants ? ' and descendants' : ''}
                          {item.retired ? ' (retired)' : ''}{' '}
                          <button
                            disabled={busy}
                            onClick={() => void mutate({ action: 'role-remove', id: item.id })}
                          >
                            Remove assignment
                          </button>
                        </div>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void mutate({
                action: 'role-assign',
                id: crypto.randomUUID(),
                user: Number(user),
                role,
                assignmentSite:
                  selectedRole?.builtin === 'tenant-administrator' ? null : scope || null,
                descendants: selectedRole?.builtin === 'tenant-administrator' ? true : descendants,
              })
            }}
          >
            <fieldset disabled={busy}>
              <legend>Assign a role</legend>
              <label>
                Member{' '}
                <select required value={user} onChange={(event) => setUser(event.target.value)}>
                  <option value="">Choose a member</option>
                  {directory.members
                    .filter((item) => item.active)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.email}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Role{' '}
                <select required value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="">Choose a role</option>
                  {roles
                    .filter(
                      (item) =>
                        !item.retired &&
                        (directory.tenantScope || item.builtin !== 'tenant-administrator'),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              {selectedRole?.builtin !== 'tenant-administrator' && (
                <>
                  <label>
                    Scope{' '}
                    <select value={scope} onChange={(event) => setScope(event.target.value)}>
                      {directory.tenantScope && selectedRole?.builtin !== 'site-administrator' && (
                        <option value="">Entire tenant</option>
                      )}
                      {directory.scopes.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={descendants}
                      onChange={(event) => setDescendants(event.target.checked)}
                    />
                    Include descendants
                  </label>
                </>
              )}
              <button type="submit">Assign role</button>
            </fieldset>
          </form>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
