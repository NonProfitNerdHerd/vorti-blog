import React, { Children, Fragment, isValidElement, type ReactNode } from 'react'
import type { ContentNode } from '../content/model'
import { compositeKinds, roleFor } from './variations'
import './variations.css'

export function Composition({ node, children }: { node: ContentNode; children: ReactNode }) {
  if (!node.variation || !compositeKinds.has(node.kind)) return <>{children}</>
  const list =
    isValidElement<{ children: ReactNode }>(children) && children.type === Fragment
      ? Children.toArray(children.props.children)
      : Children.toArray(children)
  const nodes = node.children ?? []
  const wrap = (child: ReactNode, index: number) => (
    <div key={nodes[index]?.id ?? index} data-role={nodes[index] ? roleFor(nodes[index]) : 'extra'}>
      {child}
    </div>
  )
  if (['featureGrid', 'timeline'].includes(node.kind))
    return (
      <div
        className={`block-composition block-repeater ${node.kind === 'timeline' ? 'block-timeline' : ''}`}
      >
        {list.map((child, index) => (
          <div key={nodes[index]?.id ?? index} className="block-repeat-item" data-role="item">
            {node.kind === 'timeline' && (
              <>
                <span className="timeline-marker" aria-hidden="true">
                  {(nodes[index]?.props?.marker as string) || index + 1}
                </span>
                <time>{String(nodes[index]?.props?.date ?? '')}</time>
              </>
            )}
            {child}
          </div>
        ))}
      </div>
    )
  return (
    <div className="block-composition">
      {nodes.some((n) => roleFor(n) === 'media') && (
        <div className="block-media">
          {list.map((child, index) =>
            nodes[index] && roleFor(nodes[index]) === 'media' ? wrap(child, index) : null,
          )}
        </div>
      )}
      <div className="block-content">
        {list.map((child, index) =>
          !nodes[index] || !['media', 'extra'].includes(roleFor(nodes[index]))
            ? wrap(child, index)
            : null,
        )}
      </div>
      {nodes.some((n) => roleFor(n) === 'extra') && (
        <div className="block-extra" aria-label="Additional content">
          {list.map((child, index) =>
            nodes[index] && roleFor(nodes[index]) === 'extra' ? wrap(child, index) : null,
          )}
        </div>
      )}
    </div>
  )
}
