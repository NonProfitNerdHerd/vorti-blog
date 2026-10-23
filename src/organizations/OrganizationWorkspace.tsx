'use client'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Gutter, useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import {
  informationCategories,
  siteOperations,
  type InformationCategory,
  type SiteOperation,
  type AuthorityDecision,
} from './policy'
import './workspace.css'
import { WebsiteControls } from './WebsiteControls'
import type { ScopedSiteSettings } from './site-settings'

interface Site {
  id: string
  name: string
  parent_id: string | null
  revision: number
}
interface Detail {
  settings?: { settings: ScopedSiteSettings; revision: number } | null
  site: Site
  members: Array<{ user_id: number; role: string; active: number }>
  memberNext: number | null
  grantNext: string | null
  policies: Array<{
    category: string
    operation: string
    descendants_allowed: number
    oversee_descendants: number
  }>
  grants: Array<{
    id: string
    receiver_id: string
    category: string
    operation: string
    revoked: number
  }>
  decisions: Array<AuthorityDecision & { category: string; operation: string }>
}
type Action =
  | 'create-site'
  | 'membership'
  | 'restrictions'
  | 'policy'
  | 'sharing'
  | 'move-site'
  | 'create-organization'
  | 'context'
  | 'site-settings'
export function OrganizationWorkspace() {
  const { config } = useConfig(),
    api = config.routes.api + '/organization-admin'
  const [sites, setSites] = useState<Site[]>([]),
    [next, setNext] = useState<string | null>(null)
  const [selected, setSelected] = useState(() =>
      typeof window === 'undefined'
        ? 'default'
        : new URLSearchParams(window.location.search).get('site') || 'default',
    ),
    [detail, setDetail] = useState<Detail | null>(null)
  const [operator, setOperator] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const [contextRevision, setContextRevision] = useState(0),
    [memberUser, setMemberUser] = useState(''),
    [restrictionsLoaded, setRestrictionsLoaded] = useState(false)
  const [restrictionOwner, setRestrictionOwner] = useState('')
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false)
  const [action, setAction] = useState<Action>('create-site')
  const [category, setCategory] = useState<InformationCategory>('identity'),
    [operation, setOperation] = useState<SiteOperation>('read')
  const [restriction, setRestriction] = useState<
    Array<{ category: InformationCategory; operation: SiteOperation }>
  >([])
  const [websiteDirty, setWebsiteDirty] = useState(false)
  const sequence = useRef(0),
    dirtyRef = useRef(false)
  const mutationKey = useRef<string | null>(null)
  const formRef = useRef<HTMLFieldSetElement>(null)
  useEffect(() => {
    dirtyRef.current = dirty || websiteDirty
  }, [dirty, websiteDirty])
  const request = useCallback(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(url, { ...options, cache: 'no-store' })
    const data = (await response.json()) as T & { message?: string }
    if (!response.ok)
      throw Object.assign(new Error(data.message || 'Unable to manage sites.'), {
        status: response.status,
      })
    return data as T
  }, [])
  const list = useCallback(
    async (after = '') => {
      const result = await request<{
        sites: Site[]
        next: string | null
        operator: boolean
        context: { revision: number }
      }>(api + (after ? '?after=' + encodeURIComponent(after) : ''))
      setSites((current) => (after ? [...current, ...result.sites] : result.sites))
      setNext(result.next)
      setOperator(result.operator)
      setContextRevision(result.context.revision)
    },
    [api, request],
  )
  useEffect(() => {
    const timer = setTimeout(() => void list().catch((cause) => setError(cause.message)), 0)
    return () => clearTimeout(timer)
  }, [list])
  const load = useCallback(
    async (site: string, paging = '') => {
      const generation = ++sequence.current
      setError('')
      setDetail(null)
      if (!site) return
      try {
        const data = await request<Detail>(api + '?site=' + encodeURIComponent(site) + paging)
        if (site !== 'default') {
          try {
            data.settings = await request(api + '?site=' + encodeURIComponent(site) + '&settings=1')
          } catch {
            data.settings = null
          }
        }
        if (generation === sequence.current) setDetail(data)
      } catch (cause) {
        if (generation === sequence.current)
          setError(cause instanceof Error ? cause.message : 'Site unavailable.')
      }
    },
    [api, request],
  )
  useEffect(() => {
    const timer = setTimeout(() => void load(selected), 0)
    return () => clearTimeout(timer)
  }, [load, selected])
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const navigate = (event: MouseEvent) => {
      if (
        dirtyRef.current &&
        event.target instanceof Element &&
        event.target.closest('a[href]') &&
        !window.confirm('Discard the unsaved site changes?')
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const focus = () => {
      // Recheck access without replacing an editor revision or discarding failed input.
      if (selected)
        void request<Detail>(api + '?site=' + encodeURIComponent(selected)).catch((cause) => {
          if ([401, 403, 404].includes(cause.status)) {
            sequence.current++
            setDetail(null)
            setError('Site access changed. Reload before saving.')
          }
        })
    }
    window.addEventListener('beforeunload', leave)
    document.addEventListener('click', navigate, true)
    window.addEventListener('focus', focus)
    return () => {
      window.removeEventListener('beforeunload', leave)
      document.removeEventListener('click', navigate, true)
      window.removeEventListener('focus', focus)
    }
  }, [api, request, selected])
  const change = (run: () => void) => {
    if ((dirty || websiteDirty) && !window.confirm('Discard the unsaved site changes?')) return
    run()
    setWebsiteDirty(false)
    setDirty(false)
    setMessage('')
    setError('')
    setRestriction([])
    mutationKey.current = null
    setRestrictionsLoaded(false)
    setMemberUser('')
  }
  async function submit(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (busy || (!detail && action !== 'create-organization')) return
    const invalid = Array.from(
      formRef.current?.querySelectorAll<HTMLInputElement>('input[required]') || [],
    ).find((input) => !input.checkValidity())
    if (invalid) {
      invalid.reportValidity()
      return
    }
    const values = new FormData()
    formRef.current?.querySelectorAll('input[name],select[name]').forEach((element) => {
      const input = element as unknown as HTMLInputElement
      if (
        input instanceof HTMLInputElement &&
        ['checkbox', 'radio'].includes(input.type) &&
        !input.checked
      )
        return
      values.append(input.name, input.value)
    })
    if (action === 'restrictions' && (!restrictionsLoaded || restrictionOwner !== memberUser))
      return
    const payload = {
      action,
      site: selected,
      expectedRevision:
        action === 'context'
          ? contextRevision
          : action === 'site-settings'
            ? detail?.settings?.revision
            : (detail?.site.revision ?? 0),
      settings:
        action === 'site-settings'
          ? {
              siteName: values.get('siteName'),
              siteTagline: values.get('siteTagline'),
              timezone: values.get('timezone'),
            }
          : undefined,
      operationKey: (mutationKey.current ||= crypto.randomUUID()),
      name: values.get('name'),
      routeKey: values.get('routeKey'),
      siteName: values.get('siteName'),
      user: values.get('user'),
      role: values.get('role'),
      active: values.get('active') === 'on',
      category,
      operation,
      descendantsAllowed: values.get('descendantsAllowed') === 'on',
      overseeDescendants: values.get('overseeDescendants') === 'on',
      receiver: values.get('receiver'),
      receiverDescendants: values.get('receiverDescendants') === 'on',
      revoked: values.get('revoked') === 'on',
      parent: values.get('parent'),
      expectedParentRevision: sites.find((site) => site.id === values.get('parent'))?.revision,
      denied: restriction,
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const saved = await request<{ doc: { site?: string }; initializationError?: string }>(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setDirty(false)
      mutationKey.current = null
      formRef.current?.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
        input.value = input.defaultValue
        input.checked = input.defaultChecked
      })
      setRestriction([])
      setRestrictionsLoaded(false)
      setMemberUser('')
      await list()
      if (action === 'create-site' && saved.doc.site) setSelected(saved.doc.site)
      else if (selected) await load(selected)
      setMessage(saved.initializationError || 'Saved. The change has been audited.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Save failed. Your input has been retained.',
      )
    } finally {
      setBusy(false)
    }
  }
  const siteLabel = (site: Site) => {
    const names = [site.name],
      seen = new Set([site.id])
    let parent = site.parent_id
    while (parent && !seen.has(parent)) {
      seen.add(parent)
      const ancestor = sites.find((item) => item.id === parent)
      if (!ancestor) break
      names.unshift(ancestor.name)
      parent = ancestor.parent_id
    }
    return names.join(' → ')
  }
  const policy = detail?.policies.find(
    (rule) => rule.category === category && rule.operation === operation,
  )
  const descendantNames = sites
    .filter((site) => {
      const seen = new Set<string>()
      let parent = site.parent_id
      while (parent && !seen.has(parent)) {
        if (parent === selected) return true
        seen.add(parent)
        parent = sites.find((ancestor) => ancestor.id === parent)?.parent_id || null
      }
      return false
    })
    .map(siteLabel)
  return (
    <Gutter className="vc-sites">
      <header>
        <h2>SubSites</h2>
        <Link href={`${config.routes.admin}/crm`}>CRM contacts</Link>
      </header>
      <p>
        Build National, Regional, and Local websites. Manage membership, delegated permissions, and
        inherited restrictions.
      </p>
      <p>
        <Link
          href={`${config.routes.admin}/crm${selected ? '?site=' + encodeURIComponent(selected) : ''}`}
        >
          Open CRM in the selected site
        </Link>
      </p>
      <label>
        Site to administer
        <select
          value={selected}
          disabled={busy}
          onChange={(event) =>
            change(() => {
              setDetail(null)
              setSelected(event.target.value)
            })
          }
        >
          <option value="">Choose a site</option>
          {sites.map((site) => (
            <option value={site.id} key={site.id}>
              {siteLabel(site)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!selected || busy || dirty || websiteDirty}
        onClick={() => {
          setBusy(true)
          setError('')
          void request<{ doc: { revision: number } }>(api, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'context',
              site: selected,
              expectedRevision: contextRevision,
              operationKey: crypto.randomUUID(),
            }),
          })
            .then((data) => {
              setContextRevision(data.doc.revision)
              setMessage(
                'Site preference saved for new editors. Existing editors keep their original site.',
              )
            })
            .catch((cause) => setError(cause.message))
            .finally(() => setBusy(false))
        }}
      >
        Use selected site for new editors
      </button>
      {selected && (
        <WebsiteControls
          key={selected}
          site={selected}
          onDirtyChange={setWebsiteDirty}
          descendantNames={descendantNames}
        />
      )}
      {next && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void list(next).catch((cause) => setError(cause.message))}
        >
          Load more sites
        </button>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          {dirty &&
            'Your unsaved input is retained. Reload and review the current revision before retrying.'}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {(detail || operator) && (
        <>
          {detail && (
            <section>
              <h2>{detail.site.name}</h2>
              <p>Revision {detail.site.revision}</p>
              <h3>Members</h3>
              <ul>
                {detail.members.map((member) => (
                  <li key={member.user_id}>
                    Account {member.user_id}: {member.role}
                    {member.active ? '' : ' (inactive)'}
                  </li>
                ))}
              </ul>
              {detail.memberNext && (
                <button
                  type="button"
                  disabled={busy || dirty}
                  onClick={() => void load(selected, '&memberAfter=' + detail.memberNext)}
                >
                  Next members
                </button>
              )}
              <h3>Effective permissions for your account</h3>
              <label>
                Information category
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as InformationCategory)}
                >
                  {informationCategories.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <table>
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Allowed</th>
                    <th>Reason</th>
                    <th>Controller</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.decisions
                    .filter((decision) => decision.category === category)
                    .map((decision) => (
                      <tr key={decision.operation}>
                        <td>{decision.operation}</td>
                        <td>{decision.allowed ? 'Yes' : 'No'}</td>
                        <td>{decision.reason}</td>
                        <td>{decision.controllingSite || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          )}
          <section>
            <h2>Manage site</h2>
            <label>
              Action
              <select
                value={action}
                disabled={busy}
                onChange={(event) => change(() => setAction(event.target.value as Action))}
              >
                <option value="create-site">Create child site</option>
                <option value="membership">Set membership</option>
                <option value="restrictions">Set member restrictions</option>
                <option value="policy">Set inherited policy</option>
                <option value="sharing">Review sharing</option>
                <option value="move-site">Move site</option>
                <option value="context">Use site for new editors</option>
                {detail?.settings && <option value="site-settings">Site identity settings</option>}
                {operator && (
                  <option value="create-organization">Create separate organization</option>
                )}
              </select>
            </label>
            <fieldset
              ref={formRef}
              key={`${selected}:${action}`}
              onChange={() => {
                setDirty(true)
                mutationKey.current = null
              }}
            >
              {action === 'create-site' && (
                <p>
                  New child sites start unpublished with a copy of the parent’s design. Posts,
                  pages, forms, contacts, gifts, and private work are not copied. Links to uncopied
                  content are omitted from navigation.
                </p>
              )}
              {['create-site', 'create-organization'].includes(action) && (
                <>
                  <label>
                    Name
                    <input name="name" required maxLength={160} />
                  </label>
                  {action === 'create-site' && (
                    <label>
                      Website URL key
                      <input
                        name="routeKey"
                        required
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        maxLength={80}
                      />
                    </label>
                  )}
                </>
              )}
              {action === 'create-organization' && (
                <label>
                  Root site name
                  <input name="siteName" required maxLength={160} />
                </label>
              )}
              {action === 'site-settings' && detail?.settings && (
                <>
                  <label>
                    Site name
                    <input
                      name="siteName"
                      required
                      maxLength={160}
                      defaultValue={detail.settings.settings.siteName}
                    />
                  </label>
                  <label>
                    Site tagline
                    <input
                      name="siteTagline"
                      maxLength={500}
                      defaultValue={detail.settings.settings.siteTagline}
                    />
                  </label>
                  <label>
                    Timezone
                    <input
                      name="timezone"
                      required
                      maxLength={100}
                      defaultValue={detail.settings.settings.timezone}
                    />
                  </label>
                  <p>
                    These settings belong to this site. Existing public URLs retain the
                    compatibility site’s settings.
                  </p>
                </>
              )}
              {['membership', 'restrictions'].includes(action) && (
                <label>
                  Existing account ID
                  <input
                    name="user"
                    type="number"
                    min="1"
                    required
                    value={memberUser}
                    onChange={(event) => {
                      setMemberUser(event.target.value)
                      setRestrictionsLoaded(false)
                    }}
                  />
                </label>
              )}
              {action === 'membership' && (
                <>
                  <label>
                    Role
                    <select name="role">
                      <option>reader</option>
                      <option>editor</option>
                      <option>administrator</option>
                    </select>
                  </label>
                  <label>
                    <input name="active" type="checkbox" defaultChecked /> Active membership
                  </label>
                  <p>
                    Site roles do not grant installation-operator privileges. Role expansion
                    requires authority to delegate every affected category.
                  </p>
                </>
              )}
              {['policy', 'sharing', 'restrictions'].includes(action) && (
                <>
                  <label>
                    Category
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value as InformationCategory)}
                    >
                      {informationCategories.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Operation
                    <select
                      value={operation}
                      onChange={(event) => setOperation(event.target.value as SiteOperation)}
                    >
                      {(action === 'sharing' ? ['read', 'edit'] : siteOperations).map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {action === 'policy' && (
                <div key={`${category}:${operation}`}>
                  <p>An inherited ancestor restriction remains controlling below that ancestor.</p>
                  <label>
                    <input
                      type="checkbox"
                      name="descendantsAllowed"
                      defaultChecked={policy ? !!policy.descendants_allowed : true}
                    />{' '}
                    Descendants may grant this operation
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      name="overseeDescendants"
                      defaultChecked={!!policy?.oversee_descendants}
                    />{' '}
                    This site’s members may oversee descendants
                  </label>
                </div>
              )}
              {action === 'restrictions' && (
                <>
                  <p>
                    Load the account’s existing restrictions before editing. Saving replaces the
                    reviewed set.
                  </p>
                  <button
                    type="button"
                    disabled={!memberUser || busy}
                    onClick={() => {
                      void request<{ denied: typeof restriction; revision: number }>(
                        api +
                          '?site=' +
                          encodeURIComponent(selected) +
                          '&user=' +
                          encodeURIComponent(memberUser),
                      )
                        .then((data) => {
                          if (data.revision !== detail?.site.revision)
                            throw new Error(
                              'Site changed. Reload the current revision before editing restrictions.',
                            )
                          setRestriction(data.denied)
                          setRestrictionOwner(memberUser)
                          setRestrictionsLoaded(true)
                        })
                        .catch((cause) => setError(cause.message))
                    }}
                  >
                    Load current restrictions
                  </button>
                  <button
                    type="button"
                    disabled={!restrictionsLoaded}
                    onClick={() => {
                      setDirty(true)
                      mutationKey.current = null
                      setRestriction((current) => [
                        ...current.filter(
                          (item) => item.category !== category || item.operation !== operation,
                        ),
                        { category, operation },
                      ])
                    }}
                  >
                    Add restriction
                  </button>
                  <ul>
                    {restriction.map((item) => (
                      <li key={`${item.category}:${item.operation}`}>
                        {item.category}: {item.operation}{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setDirty(true)
                            mutationKey.current = null
                            setRestriction((current) => current.filter((value) => value !== item))
                          }}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {action === 'sharing' && (
                <>
                  <label>
                    Receiving site
                    <select name="receiver" required>
                      <option value="">Choose a site you administer</option>
                      {sites
                        .filter((site) => site.id !== selected)
                        .map((site) => (
                          <option value={site.id} key={site.id}>
                            {site.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <input name="receiverDescendants" type="checkbox" /> Include receiving
                    descendants
                  </label>
                  <label>
                    <input name="revoked" type="checkbox" /> Revoke this grant
                  </label>
                  <p>
                    Saving requires category administration at both sites. Sharing never grants
                    policy administration.
                  </p>
                  <ul>
                    {detail?.grants.map((grant) => (
                      <li key={grant.id}>
                        {grant.receiver_id}: {grant.category}/{grant.operation}
                        {grant.revoked ? ' (revoked)' : ''}
                      </li>
                    ))}
                  </ul>
                  {detail?.grantNext && (
                    <button
                      type="button"
                      disabled={busy || dirty}
                      onClick={() =>
                        void load(selected, '&grantAfter=' + encodeURIComponent(detail.grantNext!))
                      }
                    >
                      Next sharing grants
                    </button>
                  )}
                </>
              )}
              {action === 'move-site' && (
                <>
                  <label>
                    New parent
                    <select name="parent" required>
                      <option value="">Choose a parent you administer</option>
                      {sites
                        .filter((site) => site.id !== selected)
                        .map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p>
                    Moves preserve the organization and immutable public route key. Root moves,
                    cycles, and subtrees larger than 200 sites are rejected.
                  </p>
                </>
              )}
              {action === 'context' && (
                <p>
                  New editors use this site. Existing contact and native document editors retain
                  their original site. Another tab’s preference change cannot retarget their saves.
                </p>
              )}
              <button
                type="button"
                onClick={(event) => void submit(event)}
                disabled={
                  busy ||
                  (!detail && action !== 'create-organization') ||
                  (action === 'restrictions' &&
                    (!restrictionsLoaded || restrictionOwner !== memberUser))
                }
              >
                {busy ? 'Saving…' : 'Save reviewed change'}
              </button>
              {dirty && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Discard input and reload the current site revision?')) {
                      setDirty(false)
                      mutationKey.current = null
                      formRef.current
                        ?.querySelectorAll<HTMLInputElement>('input')
                        .forEach((input) => {
                          input.value = input.defaultValue
                          input.checked = input.defaultChecked
                        })
                      setMemberUser('')
                      setRestriction([])
                      setRestrictionsLoaded(false)
                      if (selected) void load(selected)
                    }
                  }}
                >
                  Reload current revision
                </button>
              )}
            </fieldset>
          </section>
        </>
      )}
    </Gutter>
  )
}
