'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import {
  menuDepth,
  moveMenuBranch,
  orderedMenu,
  removeMenuItem,
  safeMenuURL,
  validateMenuItems,
  type MenuItem,
} from '@design-system/payload-design-core/content'
import './menus.css'
type RecordMenu = { id: number; name: string; items: MenuItem[]; updatedAt: string }
type Choice = { id: number; title: string }
type Locations = { primaryMenu?: number | null; footerMenu?: number | null; updatedAt?: string }
type APIResponse = Partial<RecordMenu> &
  Locations & {
    result?: Locations
    docs: RecordMenu[]
    totalPages: number
    doc: RecordMenu
    errors?: Array<{ message?: string }>
    error?: string
  }
const Caret = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="m4 6 4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.5" />
  </svg>
)
const uid = () => crypto.randomUUID()
function Destination({
  item,
  api,
  change,
}: {
  item: MenuItem
  api: string
  change: (id: number) => void
}) {
  const [query, setQuery] = useState(''),
    [docs, setDocs] = useState<Choice[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(),
      params = new URLSearchParams({
        depth: '0',
        limit: '20',
        'select[title]': 'true',
        'where[_status][equals]': 'published',
      })
    if (query) params.set('where[title][like]', query)
    const timer = setTimeout(() => {
      fetch(`${api}/${item.kind === 'page' ? 'pages' : 'posts'}?${params}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw Error('Unable to load destinations.')
          setDocs(((await response.json()) as { docs: Choice[] }).docs)
          setError('')
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message)
        })
    }, 200)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [item.kind, api, query])
  return (
    <>
      <label>
        Find another {item.kind}
        <input value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label>
        Destination
        <select value={item.target || ''} onChange={(event) => change(Number(event.target.value))}>
          {!docs.some((doc) => doc.id === item.target) && (
            <option value={item.target || ''}>
              {item.target ? `Current ${item.kind} (${item.target})` : 'Unavailable destination'}
            </option>
          )}
          {docs.map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.title}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
export function MenuWorkspaceClient() {
  const { config } = useConfig(),
    api = config.routes.api
  const [menus, setMenus] = useState<Array<Pick<RecordMenu, 'id' | 'name'>>>([]),
    [record, setRecord] = useState<RecordMenu>()
  const [name, setName] = useState(''),
    [items, setItems] = useState<MenuItem[]>([]),
    [baseline, setBaseline] = useState('')
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState<string>(),
    [source, setSource] = useState<'pages' | 'posts' | 'custom'>('pages')
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [totalPages, setTotalPages] = useState(1)
  const [choices, setChoices] = useState<Choice[]>([]),
    [checked, setChecked] = useState<Choice[]>([]),
    [pickerLoading, setPickerLoading] = useState(false),
    [pickerError, setPickerError] = useState('')
  const [customLabel, setCustomLabel] = useState(''),
    [customURL, setCustomURL] = useState('')
  const [locations, setLocations] = useState<Locations>({}),
    [locationBaseline, setLocationBaseline] = useState(''),
    [locationError, setLocationError] = useState(''),
    [locationSaving, setLocationSaving] = useState(false)
  const [drop, setDrop] = useState<{ key: string; mode: 'before' | 'inside' | 'after' }>(),
    drag = useRef<string | undefined>(undefined),
    dragX = useRef(0)
  const serialized = JSON.stringify({ name, items }),
    dirty = baseline !== serialized && !!baseline
  const locationDirty = JSON.stringify(locations) !== locationBaseline && !!locationBaseline
  const dirtyRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = dirty || locationDirty
  }, [dirty, locationDirty])
  const request = useCallback(
    async (path: string, method = 'GET', data?: unknown) => {
      const response = await fetch(`${api}/${path}`, {
        method,
        credentials: 'same-origin',
        headers: data ? { 'Content-Type': 'application/json' } : undefined,
        body: data ? JSON.stringify(data) : undefined,
      })
      const body = (await response.json()) as APIResponse
      if (!response.ok)
        throw Error(body.errors?.[0]?.message || body.error || 'Unable to save. Please try again.')
      return body
    },
    [api],
  )
  const loadMenu = useCallback(
    async (id: number) => {
      setLoading(true)
      setError('')
      setNotice('')
      try {
        const menu = (await request(`menus/${id}?depth=0`)) as RecordMenu
        setRecord(menu)
        setName(menu.name)
        setItems(orderedMenu(menu.items))
        setBaseline(JSON.stringify({ name: menu.name, items: orderedMenu(menu.items) }))
        setExpanded(undefined)
        const url = new URL(location.href)
        url.searchParams.set('menu', String(id))
        history.replaceState(null, '', url)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [request],
  )
  const listMenus = useCallback(async () => {
    const all: Array<Pick<RecordMenu, 'id' | 'name'>> = []
    let current = 1,
      pages = 1
    do {
      const result = await request(
        `menus?depth=0&limit=100&page=${current}&sort=name&select[name]=true`,
      )
      all.push(...result.docs)
      pages = result.totalPages
      current++
    } while (current <= pages)
    setMenus(all)
    return all
  }, [request])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [all, global] = await Promise.all([
          listMenus(),
          request('globals/navigation?depth=0'),
        ])
        if (!active) return
        const loc = {
          primaryMenu: global.primaryMenu || null,
          footerMenu: global.footerMenu || null,
          updatedAt: global.updatedAt,
        }
        setLocations(loc)
        setLocationBaseline(JSON.stringify(loc))
        const wanted = Number(new URL(location.href).searchParams.get('menu'))
        if (wanted || all[0]) await loadMenu(wanted || all[0].id)
        else {
          setBaseline(JSON.stringify({ name: '', items: [] }))
          setLoading(false)
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message)
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [listMenus, request, loadMenu])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault()
    }
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
      if (
        dirtyRef.current &&
        anchor &&
        anchor.target !== '_blank' &&
        anchor.href !== location.href &&
        !confirm('Discard unsaved menu changes?')
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', navigate, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', navigate, true)
    }
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (source === 'custom') return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setPickerLoading(true)
      setPickerError('')
      try {
        const params = new URLSearchParams({
          depth: '0',
          limit: '10',
          page: String(page),
          sort: '-updatedAt',
          'where[_status][equals]': 'published',
          'select[title]': 'true',
        })
        if (search) params.set('where[title][like]', search)
        const response = await fetch(`${api}/${source}?${params}`, {
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (!response.ok) throw Error('Unable to load content. Try searching again.')
        const result = (await response.json()) as { docs: Choice[]; totalPages: number }
        setChoices(result.docs)
        setTotalPages(result.totalPages || 1)
      } catch (e) {
        if (!controller.signal.aborted) setPickerError((e as Error).message)
      } finally {
        if (!controller.signal.aborted) setPickerLoading(false)
      }
    }, 150)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [source, search, page, api])
  const discard = () => !dirty || confirm('Discard unsaved changes to this menu?')
  const create = () => {
    if (!discard()) return
    setRecord(undefined)
    setName('New menu')
    setItems([])
    setBaseline('new')
    setExpanded(undefined)
    setError('')
    setNotice('')
  }
  const save = async () => {
    const validation = validateMenuItems(items)
    if (!name.trim() || validation !== true) {
      setError(!name.trim() ? 'Enter a menu name.' : String(validation))
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await request(
        record ? `menus/${record.id}?depth=0` : 'menus?depth=0',
        record ? 'PATCH' : 'POST',
        { name: name.trim(), items, expectedUpdatedAt: record?.updatedAt },
      )
      const menu = result.doc as RecordMenu
      setRecord(menu)
      setName(menu.name)
      setItems(orderedMenu(menu.items))
      setBaseline(JSON.stringify({ name: menu.name, items: orderedMenu(menu.items) }))
      setNotice(`${menu.name} was saved`)
      const url = new URL(location.href)
      url.searchParams.set('menu', String(menu.id))
      history.replaceState(null, '', url)
      await listMenus()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (
      !record ||
      !confirm(
        `Delete “${record.name}”? Its blocks and default locations will stop displaying it. This cannot be undone.${locationDirty ? ' Unsaved location changes will be discarded.' : ''}`,
      )
    )
      return
    setSaving(true)
    setError('')
    try {
      await request(`menus/${record.id}`, 'DELETE')
      const global = await request('globals/navigation?depth=0')
      const loc = {
        primaryMenu: global.primaryMenu || null,
        footerMenu: global.footerMenu || null,
        updatedAt: global.updatedAt,
      }
      setLocations(loc)
      setLocationBaseline(JSON.stringify(loc))
      const all = await listMenus()
      if (all[0]) await loadMenu(all[0].id)
      else {
        setRecord(undefined)
        setName('')
        setItems([])
        setBaseline(JSON.stringify({ name: '', items: [] }))
      }
      setNotice('Menu was deleted')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const update = (key: string, patch: Partial<MenuItem>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  const move = (item: MenuItem, action: 'up' | 'down' | 'indent' | 'outdent') => {
    const siblings = items.filter((value) => (value.parent || null) === (item.parent || null)),
      index = siblings.findIndex((value) => value.key === item.key)
    const parent = items.find((value) => value.key === item.parent)
    const next =
      action === 'up'
        ? moveMenuBranch(items, item.key, item.parent || null, siblings[index - 1]?.key)
        : action === 'down'
          ? moveMenuBranch(items, item.key, item.parent || null, siblings[index + 2]?.key)
          : action === 'indent'
            ? moveMenuBranch(items, item.key, siblings[index - 1]?.key || null)
            : moveMenuBranch(
                items,
                item.key,
                parent?.parent || null,
                items.filter((value) => (value.parent || null) === (parent?.parent || null))[
                  items
                    .filter((value) => (value.parent || null) === (parent?.parent || null))
                    .findIndex((value) => value.key === parent?.key) + 1
                ]?.key,
              )
    if (next === items) setError('That move would create a cycle or exceed five levels.')
    else {
      setItems(next)
      setError('')
    }
  }
  const active = !!record || baseline === 'new'
  return (
    <div className="menus-workspace">
      <header className="menus-workspace__heading">
        <div>
          <h1>Menus</h1>
          <p>Create once. Use throughout your site.</p>
        </div>
        <button type="button" onClick={create} disabled={saving || loading}>
          + Create menu
        </button>
      </header>
      <div className="menus-workspace__chooser">
        <label>
          Menu to edit
          <select
            aria-label="Menu to edit"
            value={record?.id || ''}
            disabled={loading || saving}
            onChange={(event) => {
              if (discard()) void loadMenu(Number(event.target.value))
            }}
          >
            <option value="" disabled>
              {baseline === 'new' ? 'New menu' : 'Choose a menu'}
            </option>
            {menus.map((menu) => (
              <option key={menu.id} value={menu.id}>
                {menu.name}
              </option>
            ))}
          </select>
        </label>
        {active && (
          <button
            className="menus-workspace__primary"
            onClick={save}
            disabled={saving || loading || !dirty}
          >
            {saving ? 'Saving…' : 'Save menu'}
          </button>
        )}
        {dirty && <span>Unsaved changes</span>}
      </div>
      {notice && (
        <div role="status" className="menus-workspace__success">
          {notice}
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="menus-workspace__error">
          {error}{' '}
          <button
            onClick={() => {
              if (!dirtyRef.current || confirm('Discard all unsaved menu changes?'))
                location.reload()
            }}
          >
            Reload saved menus
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">Loading menus…</p>
      ) : !active ? (
        <p>Create your first menu to start adding links.</p>
      ) : (
        <div className="menus-workspace__columns" inert={saving} aria-busy={saving}>
          <aside className="menus-workspace__add">
            <h2>Add menu items</h2>
            <div role="tablist" aria-label="Menu item sources">
              {(['pages', 'posts', 'custom'] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={source === value}
                  onClick={() => {
                    setSource(value)
                    setSearch('')
                    setPage(1)
                    setChecked([])
                  }}
                >
                  {value === 'custom' ? 'Custom links' : value === 'pages' ? 'Pages' : 'Posts'}
                </button>
              ))}
            </div>
            {source === 'custom' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!customLabel.trim() || !safeMenuURL(customURL)) {
                    setPickerError('Enter a label and a safe link URL.')
                    return
                  }
                  setItems([
                    ...items,
                    {
                      key: uid(),
                      label: customLabel.trim(),
                      kind: 'custom',
                      url: customURL,
                      enabled: true,
                    },
                  ])
                  setCustomLabel('')
                  setCustomURL('')
                  setPickerError('')
                }}
              >
                <label>
                  Link text
                  <input
                    value={customLabel}
                    onChange={(event) => setCustomLabel(event.target.value)}
                    required
                    maxLength={200}
                  />
                </label>
                <label>
                  URL
                  <input
                    value={customURL}
                    onChange={(event) => setCustomURL(event.target.value)}
                    required
                    placeholder="https://, /path, #section, mailto: or tel:"
                  />
                </label>
                <button disabled={saving}>Add to menu</button>
              </form>
            ) : (
              <>
                <label>
                  Search {source}
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setPage(1)
                    }}
                  />
                </label>
                {pickerLoading ? (
                  <p role="status">Loading content…</p>
                ) : (
                  <div className="menus-workspace__choices">
                    {!choices.length && <p>No published {source} found.</p>}
                    {choices.map((doc) => (
                      <label key={doc.id}>
                        <input
                          type="checkbox"
                          checked={checked.some((item) => item.id === doc.id)}
                          onChange={(event) =>
                            setChecked(
                              event.target.checked
                                ? [...checked, doc]
                                : checked.filter((item) => item.id !== doc.id),
                            )
                          }
                        />
                        {doc.title || 'Untitled'}
                      </label>
                    ))}
                  </div>
                )}
                <div className="menus-workspace__pagination">
                  <button
                    aria-label="Previous content page"
                    disabled={page <= 1 || pickerLoading}
                    onClick={() => setPage(page - 1)}
                  >
                    ←
                  </button>
                  <span>
                    {page} / {totalPages}
                  </span>
                  <button
                    aria-label="Next content page"
                    disabled={page >= totalPages || pickerLoading}
                    onClick={() => setPage(page + 1)}
                  >
                    →
                  </button>
                </div>
                <button
                  disabled={!checked.length || saving}
                  onClick={() => {
                    setItems([
                      ...items,
                      ...checked.map((doc) => ({
                        key: uid(),
                        label: doc.title || 'Untitled',
                        kind: source === 'pages' ? ('page' as const) : ('post' as const),
                        target: doc.id,
                        enabled: true,
                      })),
                    ])
                    setChecked([])
                  }}
                >
                  Add to menu{checked.length ? ` (${checked.length})` : ''}
                </button>
              </>
            )}
            {pickerError && <p role="alert">{pickerError}</p>}
          </aside>
          <section className="menus-workspace__structure" aria-label="Menu structure">
            <h2>Menu structure</h2>
            <label>
              Menu name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
              />
            </label>
            <p className="menus-workspace__hint">
              Drag to reorder; drag right to nest. Expand a row for settings and keyboard move
              controls.
            </p>
            <ol>
              {items.map((item) => {
                const depth = menuDepth(items, item.key),
                  siblings = items.filter(
                    (value) => (value.parent || null) === (item.parent || null),
                  ),
                  index = siblings.findIndex((value) => value.key === item.key)
                return (
                  <li
                    key={item.key}
                    style={{ marginLeft: `${(depth - 1) * 24}px` }}
                    data-drop={drop?.key === item.key ? drop.mode : undefined}
                  >
                    <div
                      className="menus-workspace__row"
                      draggable={!saving}
                      onDragStart={(event) => {
                        drag.current = item.key
                        dragX.current = event.clientX
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', item.key)
                      }}
                      onDragEnd={() => {
                        drag.current = undefined
                        setDrop(undefined)
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        const rect = event.currentTarget.getBoundingClientRect()
                        setDrop({
                          key: item.key,
                          mode:
                            event.clientX > dragX.current + 24
                              ? 'inside'
                              : event.clientY < rect.top + rect.height / 2
                                ? 'before'
                                : 'after',
                        })
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        if (!drag.current || !drop || drag.current === item.key) return
                        const before =
                          drop.mode === 'before'
                            ? item.key
                            : drop.mode === 'after'
                              ? siblings[index + 1]?.key
                              : undefined
                        const next = moveMenuBranch(
                          items,
                          drag.current,
                          drop.mode === 'inside' ? item.key : item.parent || null,
                          before,
                        )
                        if (next === items)
                          setError('That move would create a cycle or exceed five levels.')
                        else {
                          setItems(next)
                          setError('')
                        }
                        setDrop(undefined)
                      }}
                    >
                      <span aria-hidden="true" className="menus-workspace__handle">
                        ⠿
                      </span>
                      <strong>{item.label || 'Untitled'}</strong>
                      <span>
                        {item.kind === 'custom' ? 'Link' : item.kind === 'page' ? 'Page' : 'Post'}
                        {item.enabled === false ? ' · Hidden' : ''}
                      </span>
                      <button
                        className="menus-workspace__icon"
                        aria-label={`Edit ${item.label}`}
                        aria-expanded={expanded === item.key}
                        onClick={() => setExpanded(expanded === item.key ? undefined : item.key)}
                      >
                        <Caret />
                      </button>
                    </div>
                    {expanded === item.key && (
                      <div className="menus-workspace__settings">
                        <label>
                          Navigation label
                          <input
                            value={item.label}
                            onChange={(event) => update(item.key, { label: event.target.value })}
                            maxLength={200}
                          />
                        </label>
                        {item.kind === 'custom' ? (
                          <label>
                            Destination URL
                            <input
                              value={item.url || ''}
                              onChange={(event) => update(item.key, { url: event.target.value })}
                            />
                          </label>
                        ) : (
                          <>
                            <Destination
                              item={item}
                              api={api}
                              change={(target) => update(item.key, { target })}
                            />
                            <p>
                              Linked {item.kind}:{' '}
                              <a
                                target="_blank"
                                rel="noreferrer"
                                href={`${config.routes.admin}/collections/${item.kind === 'page' ? 'pages' : 'posts'}/${item.target}`}
                              >
                                Open destination
                              </a>
                            </p>
                          </>
                        )}
                        <label className="menus-workspace__check">
                          <input
                            type="checkbox"
                            checked={item.enabled !== false}
                            onChange={(event) =>
                              update(item.key, { enabled: event.target.checked })
                            }
                          />
                          Enabled
                        </label>
                        <label className="menus-workspace__check">
                          <input
                            type="checkbox"
                            checked={!!item.newTab}
                            onChange={(event) => update(item.key, { newTab: event.target.checked })}
                          />
                          Open in new tab
                        </label>
                        <div className="menus-workspace__moves">
                          <button disabled={saving || index === 0} onClick={() => move(item, 'up')}>
                            Move up
                          </button>
                          <button
                            disabled={saving || index === siblings.length - 1}
                            onClick={() => move(item, 'down')}
                          >
                            Move down
                          </button>
                          <button
                            disabled={saving || index === 0}
                            onClick={() => move(item, 'indent')}
                          >
                            Indent
                          </button>
                          <button
                            disabled={saving || !item.parent}
                            onClick={() => move(item, 'outdent')}
                          >
                            Outdent
                          </button>
                        </div>
                        <div className="menus-workspace__moves">
                          <button
                            className="menus-workspace__danger"
                            onClick={() => setItems(removeMenuItem(items, item.key, false))}
                          >
                            Remove item only
                          </button>
                          <button
                            className="menus-workspace__danger"
                            onClick={() => {
                              if (confirm('Remove this item and all its sublinks?'))
                                setItems(removeMenuItem(items, item.key, true))
                            }}
                          >
                            Remove branch
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
            {!items.length && (
              <p className="menus-workspace__empty">
                Add pages, posts, or links to build this menu.
              </p>
            )}
            <footer>
              <button
                className="menus-workspace__primary"
                onClick={save}
                disabled={saving || !dirty}
              >
                {saving ? 'Saving…' : 'Save menu'}
              </button>
              {record && (
                <button
                  className="menus-workspace__danger"
                  onClick={remove}
                  disabled={saving || locationSaving}
                >
                  Delete menu
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
      <details className="menus-workspace__locations">
        <summary>Default locations</summary>
        <p>
          Used by legacy headers, footers, and existing template menu sources. New Menu blocks can
          select any saved menu.
        </p>
        {(['primary', 'footer'] as const).map((slot) => (
          <label key={slot}>
            {slot === 'primary' ? 'Primary' : 'Footer'}
            <select
              disabled={locationSaving || saving}
              value={locations[`${slot}Menu`] || ''}
              onChange={(event) =>
                setLocations({ ...locations, [`${slot}Menu`]: Number(event.target.value) || null })
              }
            >
              <option value="">No menu</option>
              {menus.map((menu) => (
                <option key={menu.id} value={menu.id}>
                  {menu.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button
          disabled={!locationDirty || locationSaving || saving}
          onClick={async () => {
            setLocationSaving(true)
            setLocationError('')
            try {
              const result = await request('globals/navigation?depth=0', 'POST', {
                primaryMenu: locations.primaryMenu,
                footerMenu: locations.footerMenu,
                expectedUpdatedAt: locations.updatedAt,
              })
              const saved = (result.result || result.doc || result) as Locations
              const loc = {
                primaryMenu: saved.primaryMenu || null,
                footerMenu: saved.footerMenu || null,
                updatedAt: saved.updatedAt,
              }
              setLocations(loc)
              setLocationBaseline(JSON.stringify(loc))
              setNotice('Menu locations were saved')
            } catch (e) {
              setLocationError((e as Error).message)
            } finally {
              setLocationSaving(false)
            }
          }}
        >
          {locationSaving ? 'Saving…' : 'Save locations'}
        </button>
        {locationError && <p role="alert">{locationError}</p>}
      </details>
    </div>
  )
}
