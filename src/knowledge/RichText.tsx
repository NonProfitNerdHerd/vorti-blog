import { Fragment, type ReactNode } from 'react'
import { wikiOutline } from './wiki-view'
type Node = {
  type: string
  text?: string
  format?: number
  tag?: string
  listType?: string
  url?: string
  fields?: { url?: string }
  children?: Node[]
}
export function KnowledgeRichText({
  body,
  anchorPrefix = '',
}: {
  body: unknown
  anchorPrefix?: string
}) {
  const headings = new Map(wikiOutline(body).map((heading) => [heading.node, heading]))
  const render = (node: Node, key: number): ReactNode => {
    const children = node.children?.map(render)
    if (node.type === 'text') {
      let text: ReactNode = node.text || ''
      if ((node.format || 0) & 1) text = <strong>{text}</strong>
      if ((node.format || 0) & 2) text = <em>{text}</em>
      if ((node.format || 0) & 4) text = <s>{text}</s>
      if ((node.format || 0) & 8) text = <u>{text}</u>
      if ((node.format || 0) & 16) text = <code>{text}</code>
      return <Fragment key={key}>{text}</Fragment>
    }
    if (node.type === 'paragraph') return <p key={key}>{children}</p>
    if (node.type === 'heading') {
      const heading = headings.get(node),
        Tag = `h${heading?.level || 2}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag key={key} id={heading ? anchorPrefix + heading.id : undefined}>
          {children}
        </Tag>
      )
    }
    if (node.type === 'quote') return <blockquote key={key}>{children}</blockquote>
    if (node.type === 'list')
      return node.listType === 'number' ? (
        <ol key={key}>{children}</ol>
      ) : (
        <ul key={key}>{children}</ul>
      )
    if (node.type === 'listitem') return <li key={key}>{children}</li>
    if (node.type === 'linebreak') return <br key={key} />
    if (node.type === 'link') {
      const url = node.url || node.fields?.url || ''
      return /^(https?:\/\/|mailto:|\/(?!\/))/i.test(url) ? (
        <a key={key} href={url} rel="noreferrer">
          {children}
        </a>
      ) : (
        <Fragment key={key}>{children}</Fragment>
      )
    }
    return <Fragment key={key}>{children}</Fragment>
  }
  return <div className="knowledge-content">{render((body as { root: Node }).root, 0)}</div>
}
