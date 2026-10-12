'use client'
import { BlockGlyph } from '../blocks/BlockGlyph'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { SidebarAdapter, SidebarState } from './BuilderSidebar'
import { flattenSidebar, locateSidebar, type SidebarNode } from './sidebar-model'
import { InspectorIcon } from './InspectorControls'
import './block-actions.css'

export function BlockActionMenu({
  node,
  adapter,
  state,
}: {
  node: SidebarNode
  adapter: SidebarAdapter
  state: SidebarState
}) {
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState<Element | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const location = locateSidebar(adapter.nodes, node.id)
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      setPosition({
        left: Math.max(
          8,
          Math.min(rect.left, window.innerWidth - (menu.current?.offsetWidth ?? 240) - 8),
        ),
        top: Math.max(
          8,
          Math.min(rect.bottom + 4, window.innerHeight - (menu.current?.offsetHeight ?? 300) - 8),
        ),
      })
    }
    place()
    menu.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])
  if (!location || !adapter.canEdit || adapter.locked || node.ownerID || node.immovable) return null
  const run = (action: () => void) => {
    close()
    action()
  }
  const move = (before?: string) =>
    run(() => adapter.onMove(node.id, { parent: location.parent, before }))
  const excluded = new Set(flattenSidebar([node]).map((child) => child.id))
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="block-actions__trigger"
        aria-label={`Actions for ${node.label}`}
        title={`Actions for ${node.label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          setHost(event.currentTarget.closest('.doc-drawer, [role="dialog"]') ?? document.body)
          setOpen(!open)
        }}
      >
        <InspectorIcon name="more" />
      </button>
      {open &&
        host &&
        createPortal(
          <div
            ref={menu}
            className="block-actions__menu"
            role="dialog"
            aria-label={`${node.label} actions`}
            style={position}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (
                !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key) ||
                event.target instanceof HTMLSelectElement
              )
                return
              const items = Array.from(
                menu.current?.querySelectorAll<HTMLElement>('button,select') ?? [],
              )
              const enabled = items.filter((item) => !(item as HTMLButtonElement).disabled)
              const index = enabled.indexOf(document.activeElement as HTMLElement)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? enabled.length - 1
                    : (index +
                        (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)
                          ? -1
                          : 1) +
                        enabled.length) %
                      enabled.length
              event.preventDefault()
              enabled[next]?.focus()
            }}
          >
            <button
              type="button"
              disabled={location.index === 0}
              onClick={() => move(location.siblings[location.index - 1]?.id)}
            >
              Move up
            </button>
            <button
              type="button"
              disabled={location.index === location.siblings.length - 1}
              onClick={() => move(location.siblings[location.index + 2]?.id)}
            >
              Move down
            </button>
            {adapter.onDuplicate && (
              <button type="button" onClick={() => run(() => adapter.onDuplicate?.(node.id))}>
                Duplicate
              </button>
            )}
            {node.kind !== 'column' && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    run(() => state.insert({ parent: location.parent, before: node.id }))
                  }
                >
                  Add before
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(() =>
                      state.insert({
                        parent: location.parent,
                        before: location.siblings[location.index + 1]?.id,
                      }),
                    )
                  }
                >
                  Add after
                </button>
                <label>
                  Move to…
                  <select
                    aria-label={`Move ${node.label} into`}
                    value=""
                    onChange={(event) => {
                      if (event.target.value)
                        run(() => adapter.onMove(node.id, { parent: event.target.value }))
                    }}
                  >
                    <option value="">Choose destination</option>
                    <option value="root">Document top level</option>
                    {flattenSidebar(adapter.nodes)
                      .filter(
                        (candidate) =>
                          candidate.container && !candidate.ownerID && !excluded.has(candidate.id),
                      )
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.label}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            {adapter.onDelete && (
              <button
                type="button"
                className="block-actions__delete"
                onClick={() => run(() => adapter.onDelete?.(node.id))}
              >
                Delete
              </button>
            )}
          </div>,
          host,
        )}
    </>
  )
}

/** Lives with the adapter, including when the hierarchy panel is closed. */
export function SelectedBlockToolbar({
  adapter,
  state,
  scope,
}: {
  adapter: SidebarAdapter
  state: SidebarState
  scope: RefObject<HTMLDivElement | null>
}) {
  const toolbar = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false })
  const node = flattenSidebar(adapter.nodes).find((item) => item.id === adapter.selected)
  useEffect(() => {
    const root = scope.current?.closest('.builder-frame')
    const find = () =>
      setAnchor(
        Array.from(root?.querySelectorAll<HTMLElement>('[data-builder-node]') ?? []).find(
          (element) => element.dataset.builderNode === adapter.selected,
        ) ?? null,
      )
    find()
    const observer = new MutationObserver(find)
    if (root) observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [adapter.selected, scope])
  useLayoutEffect(() => {
    if (!anchor) return
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const bounds = anchor
        .closest('.content-workspace__center, .template-editor__canvas')
        ?.getBoundingClientRect()
      const width = toolbar.current?.offsetWidth ?? 148
      const height = toolbar.current?.offsetHeight ?? 36
      const top = Math.max(8, bounds?.top ?? 0)
      const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight)
      setPosition({
        left: Math.max(
          bounds?.left ?? 8,
          Math.min(rect.left, (bounds?.right ?? window.innerWidth) - width),
        ),
        top: Math.max(top, Math.min(rect.top - height - 4, bottom - height)),
        visible: rect.bottom > top && rect.top < bottom,
      })
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(anchor)
    const canvas = anchor.closest('.content-workspace__center, .template-editor__canvas')
    if (canvas) observer?.observe(canvas)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor])
  if (!node || !anchor || !adapter.canEdit || adapter.locked || node.ownerID || node.immovable)
    return null
  const location = locateSidebar(adapter.nodes, node.id)!
  return createPortal(
    <div
      ref={toolbar}
      className="block-actions__toolbar"
      role="toolbar"
      aria-label={`${node.label} block controls`}
      style={{
        left: position.left,
        top: position.top,
        visibility: position.visible ? 'visible' : 'hidden',
      }}
    >
      <span title={node.label} aria-label={node.label}>
        {<BlockGlyph kind={node.kind}/>}
      </span>
      <button
        type="button"
        title="Move up"
        aria-label={`Move ${node.label} up`}
        disabled={location.index === 0}
        onClick={() =>
          adapter.onMove(node.id, {
            parent: location.parent,
            before: location.siblings[location.index - 1]?.id,
          })
        }
      >
        <InspectorIcon name="up" />
      </button>
      <button
        type="button"
        title="Move down"
        aria-label={`Move ${node.label} down`}
        disabled={location.index === location.siblings.length - 1}
        onClick={() =>
          adapter.onMove(node.id, {
            parent: location.parent,
            before: location.siblings[location.index + 2]?.id,
          })
        }
      >
        <InspectorIcon name="down" />
      </button>
      <BlockActionMenu key={node.id} node={node} adapter={adapter} state={state} />
    </div>,
    anchor.closest('.doc-drawer, [role="dialog"]') ?? document.body,
  )
}
