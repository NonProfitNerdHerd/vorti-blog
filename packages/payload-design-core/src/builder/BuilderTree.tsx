'use client'
/* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs through hook results. */

import { useDraggable } from '@dnd-kit/core'
import type { CSSProperties, ReactNode } from 'react'
import type { BuilderDragItem } from './BuilderCore'
import { DropArea } from './DropArea'

export type BuilderChildContainer<TNode> = {
  children: TNode[]
  className?: string
  id: string
  label: string
  listLabel?: string
}

export type BuilderNodeDescriptor<TNode> = {
  body: ReactNode
  bodyAriaLabel?: string
  children?: BuilderChildContainer<TNode>[]
  childrenClassName?: string
  childrenStyle?: CSSProperties
  icon?: ReactNode
  listTitle?: string
  title: string
}

export type BuilderTreeActions<TNode> = {
  add: (containerID: string) => void
  addItem: (item: BuilderDragItem, containerID: string) => void
  edit: (node: TNode) => void
  move: (id: string, direction: -1 | 1) => void
  remove: (id: string) => void
}

export function BuilderCanvasTree<TNode>({ actions, describe, id, nodes, selectedID }: {
  actions: BuilderTreeActions<TNode>
  describe: (node: TNode) => BuilderNodeDescriptor<TNode>
  id: (node: TNode) => string
  nodes: TNode[]
  selectedID?: string
}) {
  return <div className="template-editor__tree">{nodes.map((node) => <CanvasNode key={id(node)} node={node} siblings={nodes} actions={actions} describe={describe} id={id} selectedID={selectedID} />)}</div>
}

function CanvasNode<TNode>({ actions, describe, id, node, selectedID, siblings }: {
  actions: BuilderTreeActions<TNode>
  describe: (node: TNode) => BuilderNodeDescriptor<TNode>
  id: (node: TNode) => string
  node: TNode
  selectedID?: string
  siblings: TNode[]
}) {
  const nodeID = id(node)
  const descriptor = describe(node)
  const drag = useDraggable({ id: `node:${nodeID}`, data: { nodeID } })
  const index = siblings.findIndex((item) => id(item) === nodeID)
  return (
    <article ref={drag.setNodeRef} className="template-editor__node" data-selected={selectedID === nodeID}>
      <div className="template-editor__toolbar">
        <button type="button" className="template-editor__tool-button" {...drag.listeners} {...drag.attributes} aria-label={`Drag ${descriptor.title}`} title="Drag">⠿</button>
        <button type="button" className="template-editor__tool-button" aria-label={`Edit ${descriptor.title}`} title="Settings" onClick={() => actions.edit(node)}>⚙</button>
        <button type="button" className="template-editor__tool-button" aria-label={`Move ${descriptor.title} up`} title="Move up" disabled={index <= 0} onClick={() => actions.move(nodeID, -1)}>↑</button>
        <button type="button" className="template-editor__tool-button" aria-label={`Move ${descriptor.title} down`} title="Move down" disabled={index === siblings.length - 1} onClick={() => actions.move(nodeID, 1)}>↓</button>
        <button type="button" className="template-editor__tool-button template-editor__tool-button--danger" aria-label={`Remove ${descriptor.title}`} title="Remove" onClick={() => actions.remove(nodeID)}>×</button>
      </div>
      <div className="template-editor__node-body" role="button" tabIndex={0} aria-label={descriptor.bodyAriaLabel} onClick={() => actions.edit(node)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') actions.edit(node) }}>
        {descriptor.body}
      </div>
      {descriptor.children?.length ? (
        descriptor.childrenClassName || descriptor.childrenStyle ? <div className={descriptor.childrenClassName} style={descriptor.childrenStyle}>
          {descriptor.children.map((container) => <div className={container.className} key={container.id}>
              <DropArea id={container.id} label={container.label} add={() => actions.add(container.id)} addItem={(item) => actions.addItem(item, container.id)}>
                <BuilderCanvasTree nodes={container.children} actions={actions} describe={describe} id={id} selectedID={selectedID} />
              </DropArea>
            </div>)}
        </div> : <>{descriptor.children.map((container) => <DropArea key={container.id} id={container.id} label={container.label} add={() => actions.add(container.id)} addItem={(item) => actions.addItem(item, container.id)}><BuilderCanvasTree nodes={container.children} actions={actions} describe={describe} id={id} selectedID={selectedID} /></DropArea>)}</>
      ) : null}
    </article>
  )
}

export function BuilderListView<TNode>({ describe, id, nodes, onSelect, selectedID, depth = 0 }: {
  depth?: number
  describe: (node: TNode) => BuilderNodeDescriptor<TNode>
  id: (node: TNode) => string
  nodes: TNode[]
  onSelect: (node: TNode) => void
  selectedID?: string
}) {
  return <div role={depth ? 'group' : 'tree'} aria-label={depth ? undefined : 'Template block list'}>{nodes.map((node) => {
    const descriptor = describe(node)
    const nodeID = id(node)
    return <div key={nodeID} role="treeitem" aria-level={depth + 1} aria-selected={selectedID === nodeID} style={{ marginLeft: depth * 12 }}><button type="button" className="template-editor__list-row" data-selected={selectedID === nodeID} onClick={() => onSelect(node)}><span className="template-editor__list-icon" aria-hidden="true">{descriptor.icon ?? '¶'}</span><span>{descriptor.listTitle ?? descriptor.title}</span></button>{descriptor.children?.map((container) => container.listLabel ? <div key={container.id} style={{ marginLeft: (depth + 1) * 12 }}><div className="template-editor__column-label">{container.listLabel}</div><BuilderListView nodes={container.children} describe={describe} id={id} onSelect={onSelect} selectedID={selectedID} depth={depth + 2} /></div> : <BuilderListView key={container.id} nodes={container.children} describe={describe} id={id} onSelect={onSelect} selectedID={selectedID} depth={depth + 1} />)}</div>
  })}</div>
}
