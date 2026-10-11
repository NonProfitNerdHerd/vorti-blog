'use client'
/* eslint-disable react-hooks/refs -- dnd-kit supplies callback refs; opener is only read in event handlers. */
import { getBlockDefinition } from '../blocks/registry'
import { useEffect, useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { BuilderDragItem } from './BuilderCore'
import {
  flattenSidebar,
  insertionTarget,
  locateSidebar,
  outlineSummary,
  type InsertionTarget,
  type SidebarNode,
} from './sidebar-model'
import './builder-sidebar.css'
import { BlockActionMenu, SelectedBlockToolbar } from './BlockActions'

export type SidebarItem = BuilderDragItem & { category: string; keywords?: string[] }
export type SidebarMode = 'list' | 'outline' | 'blocks'
export function useBuilderSidebar(identity?: string) {
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState<SidebarMode>('list')
  const [target, setTarget] = useState<InsertionTarget | undefined>()
  const opener = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setOpen(false)
      setTarget(undefined)
      opener.current?.focus()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open])
  useEffect(() => {
    // Reset UI state on document/region changes; these values are never persisted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(undefined)
    setMode('list')
    const media = window.matchMedia?.('(max-width: 1100px)')
    setOpen(!media?.matches)
    const change = () => {
      if (media?.matches) setOpen(false)
    }
    media?.addEventListener('change', change)
    return () => media?.removeEventListener('change', change)
  }, [identity])
  const close = () => {
    setOpen(false)
    setTarget(undefined)
    opener.current?.focus()
  }
  const insert = (destination?: InsertionTarget) => {
    setTarget(destination)
    setMode('blocks')
    setOpen(true)
    if (window.document.activeElement instanceof HTMLButtonElement)
      opener.current = window.document.activeElement
  }
  const inserted = () => {
    setTarget(undefined)
    setMode('list')
    if (window.matchMedia?.('(max-width: 1100px)').matches) close()
  }
  return {
    open,
    setOpen,
    mode,
    setMode,
    target,
    rememberOpener: (button: HTMLButtonElement) => {
      opener.current = button
    },
    close,
    insert,
    inserted,
  }
}
export type SidebarState = ReturnType<typeof useBuilderSidebar>

export function SidebarControls({
  state,
  canInsert = true,
}: {
  state: SidebarState
  canInsert?: boolean
}) {
  return (
    <span className="builder-sidebar-controls">
      {canInsert && (
        <button
          type="button"
          aria-label="Add block"
          title="Add block"
          aria-expanded={state.open && state.mode === 'blocks'}
          onClick={(event) => {
            state.insert()
            state.rememberOpener(event.currentTarget)
          }}
        >
          <span aria-hidden="true">+</span>
        </button>
      )}
      <button
        type="button"
        aria-label="List View"
        title="List View"
        aria-expanded={state.open && state.mode !== 'blocks'}
        onClick={(event) => {
          state.rememberOpener(event.currentTarget)
          state.setMode('list')
          state.setOpen(!(state.open && state.mode !== 'blocks'))
        }}
      >
        <span aria-hidden="true">☷</span>
      </button>
    </span>
  )
}
function icon(kind: string) {
  const registered = getBlockDefinition(kind)
  if (registered) return registered.icon
  if (/heading|shortText/i.test(kind)) return 'H'
  if (/image|gallery|logo|images/i.test(kind)) return '▧'
  if (/column|row|group|container|stack/i.test(kind)) return '▤'
  if (/list/i.test(kind)) return '☷'
  if (/quote/i.test(kind)) return '❞'
  if (/button|link|navigation/i.test(kind)) return '↗'
  if (/text|paragraph/i.test(kind)) return '¶'
  return '◇'
}
export type SidebarAdapter = {
  nodes: SidebarNode[]
  selected?: string
  items: SidebarItem[]
  canEdit: boolean
  locked?: boolean
  onSelect: (id: string) => void
  onInsert: (item: SidebarItem, target: InsertionTarget) => void
  onMove: (id: string, target: InsertionTarget) => void
  onDuplicate?: (id: string) => void
  onDelete?: (id: string) => void
}
export function BuilderSidebar({
  state,
  adapter,
}: {
  state: SidebarState
  adapter: SidebarAdapter
}) {
  const [query, setQuery] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const { nodes, selected, canEdit, locked } = adapter
  const summary = outlineSummary(nodes)
  useEffect(() => {
    if (state.open && state.mode === 'blocks') panel.current?.querySelector('input')?.focus()
  }, [state.open, state.mode])
  const choose = (node: SidebarNode) => {
    const id = node.ownerID ?? node.id
    adapter.onSelect(id)
    const root = panel.current?.closest('.content-workspace, .template-editor')
    requestAnimationFrame(() => {
      const element = Array.from(
        root?.querySelectorAll<HTMLElement>('[data-builder-node]') ?? [],
      ).find((element) => element.dataset.builderNode === id)
      element?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    })
    if (window.matchMedia?.('(max-width: 1100px)').matches) state.close()
  }
  const visibleItems = adapter.items.filter((item) =>
    `${item.label} ${item.category} ${item.keywords?.join(' ') ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  )
  return (
    <div
      className="builder-sidebar"
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          state.close()
        }
      }}
    >
      <SelectedBlockToolbar adapter={adapter} state={state} scope={panel} />
      <div className="builder-sidebar__header">
        {state.mode === 'blocks' && canEdit ? (
          <strong>Blocks</strong>
        ) : (
          <div role="tablist" aria-label="Block navigation">
            {(['list', 'outline'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={state.mode === mode}
                onClick={() => state.setMode(mode)}
              >
                {mode === 'list' ? 'List View' : 'Outline'}
              </button>
            ))}
          </div>
        )}
        <button type="button" aria-label="Close left panel" onClick={state.close}>
          ×
        </button>
      </div>
      {state.mode === 'blocks' && canEdit ? (
        <div className="builder-sidebar__inserter">
          <input
            aria-label="Search blocks"
            placeholder="Search blocks"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {[...new Set(visibleItems.map((item) => item.category))].map((category) => (
            <section key={category}>
              <h3>{category}</h3>
              <div className="builder-sidebar__grid">
                {visibleItems
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <Tile
                      key={`${item.kind}:${item.value}`}
                      item={item}
                      onClick={() =>
                        adapter.onInsert(item, state.target ?? insertionTarget(nodes, selected))
                      }
                    />
                  ))}
              </div>
            </section>
          ))}
          {!visibleItems.length && <p>No matching blocks.</p>}
        </div>
      ) : state.mode === 'outline' ? (
        <div className="builder-sidebar__outline" role="tabpanel" aria-label="Outline">
          <p>
            {summary.words} words · {summary.minutes} min read
          </p>
          {summary.headings.length ? (
            summary.headings.map((node) => (
              <button
                key={node.id}
                type="button"
                style={{ paddingLeft: `${Math.max(0, (node.heading ?? 1) - 1) * 12 + 8}px` }}
                onClick={() => choose(node)}
              >
                <small>H{node.heading}</small> {node.text}
              </button>
            ))
          ) : (
            <p>No headings yet. Add a heading to create an outline.</p>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="List View">
          {!nodes.length && (
            <p className="builder-sidebar__empty">
              No blocks yet.{canEdit && ' Use + to add your first block.'}
            </p>
          )}
          <ul className="builder-sidebar__tree" aria-label="Block hierarchy">
            {nodes.map((node) => (
              <Row key={node.id} node={node} adapter={adapter} choose={choose} state={state} />
            ))}
          </ul>
          {canEdit && !locked && (
            <TreeDrop target={{ parent: 'root' }} label="Move to document end" />
          )}
        </div>
      )}
    </div>
  )
}
function Tile({ item, onClick }: { item: SidebarItem; onClick: () => void }) {
  const drag = useDraggable({
    id: `sidebar-library:${item.kind}:${item.value}`,
    data: { library: item },
  })
  return (
    <button
      type="button"
      ref={drag.setNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      className="builder-sidebar__tile"
      onClick={onClick}
      aria-label={item.label}
    >
      <span aria-hidden="true">{icon(item.value || item.kind)}</span>
      <span>{item.label}</span>
    </button>
  )
}
function TreeDrop({ target, label }: { target: InsertionTarget; label: string }) {
  const drop = useDroppable({
    id: `sidebar-drop:${target.parent}:${target.before ?? 'end'}`,
    data: { containerID: target.parent, beforeID: target.before },
  })
  return (
    <div
      ref={drop.setNodeRef}
      className="builder-sidebar__drop"
      data-over={drop.isOver}
      aria-label={label}
    >
      {label}
    </div>
  )
}
function Row({
  node,
  adapter,
  choose,
  state,
}: {
  node: SidebarNode
  adapter: SidebarAdapter
  choose: (node: SidebarNode) => void
  state: SidebarState
}) {
  const { nodes, selected, canEdit, locked } = adapter
  const location = locateSidebar(nodes, node.id)!
  const [collapsed, setCollapsed] = useState(false)
  const selectedWithin = flattenSidebar(node.children ?? []).some((child) => child.id === selected)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Canvas selection reveals the selected block's ancestors.
    if (selectedWithin) setCollapsed(false)
  }, [selected, selectedWithin])
  const editable = canEdit && !locked && !node.ownerID && !node.immovable
  const drag = useDraggable({
    id: `sidebar-node:${node.id}`,
    data: { nodeID: node.id },
    disabled: !editable,
  })
  const hasChildren = Boolean(node.children?.length)
  const selectRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected === node.id) selectRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, node.id])
  return (
    <li>
      {editable && (
        <TreeDrop
          target={{ parent: location.parent, before: node.id }}
          label={`Insert before ${node.label}`}
        />
      )}
      <div className="builder-sidebar__row" data-selected={selected === node.id}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${node.label}`}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? '›' : '⌄'}
          </button>
        ) : (
          <span className="builder-sidebar__indent" />
        )}
        <button
          type="button"
          className="builder-sidebar__select"
          ref={(element) => {
            selectRef.current = element
            drag.setNodeRef(element)
          }}
          {...(editable ? drag.attributes : {})}
          {...(editable ? drag.listeners : {})}
          aria-current={selected === node.id ? 'true' : undefined}
          onClick={() => {
            if (!drag.isDragging) choose(node)
          }}
          title={node.label}
        >
          <span aria-hidden="true">{icon(node.kind)}</span>
          <span>{node.label}</span>
          {locked && <span aria-label="Locked">▣</span>}
        </button>
        {editable && <BlockActionMenu node={node} adapter={adapter} state={state} />}
      </div>
      {hasChildren && !collapsed && (
        <ul>
          {node.children!.map((child) => (
            <Row key={child.id} node={child} adapter={adapter} choose={choose} state={state} />
          ))}
        </ul>
      )}
      {node.container && canEdit && !locked && !node.ownerID && (
        <TreeDrop target={{ parent: node.id }} label={`Insert into ${node.label}`} />
      )}
    </li>
  )
}
