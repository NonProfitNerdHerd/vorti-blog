export type KnowledgeKind = 'wiki' | 'intranet'
export const emptyKnowledgeBody = {
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [] as unknown[],
        direction: null as null,
        format: '',
        indent: 0,
      },
    ],
    direction: null as null,
    format: '',
    indent: 0,
  },
}
const allowed = new Set([
  'root',
  'paragraph',
  'text',
  'heading',
  'quote',
  'list',
  'listitem',
  'link',
  'linebreak',
])
/** Accept structured rich text only; HTML, scripts, embeds and arbitrary serialized nodes are rejected. */
export function validateKnowledgeBody(input: unknown): { body: string; text: string } {
  const source = JSON.stringify(input)
  if (!source || source.length > 300000) throw Error('Use a document smaller than 300 KB.')
  const document = JSON.parse(source) as { root?: unknown }
  let count = 0
  const text: string[] = []
  const visit = (value: unknown, depth: number) => {
    if (
      ++count > 10000 ||
      depth > 32 ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    )
      throw Error('Invalid rich text document.')
    const node = value as Record<string, unknown>
    if (typeof node.type !== 'string' || !allowed.has(node.type))
      throw Error('Unsupported rich text node.')
    if (node.type === 'text') {
      if (
        typeof node.text !== 'string' ||
        typeof node.format !== 'number' ||
        !Number.isInteger(node.format) ||
        node.format < 0 ||
        node.format > 255
      )
        throw Error('Invalid text formatting.')
      text.push(node.text)
    }
    if (node.type === 'heading' && !['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(String(node.tag)))
      throw Error('Invalid heading.')
    if (node.type === 'link') {
      const url = node.url ?? (node.fields as Record<string, unknown> | undefined)?.url
      if (
        typeof url !== 'string' ||
        !(/^(https?:\/\/|mailto:)/i.test(url) || /^\/(?!\/)/.test(url)) ||
        /[\u0000-\u0020\\]/.test(url)
      )
        throw Error('Use a safe link URL.')
    }
    if ('children' in node) {
      if (!Array.isArray(node.children)) throw Error('Invalid rich text children.')
      for (const child of node.children) visit(child, depth + 1)
    }
    // Styling is represented by known formatting commands, never caller CSS or HTML.
    delete node.style
    delete node.html
  }
  visit(document.root, 0)
  if ((document.root as { type: string }).type !== 'root') throw Error('Invalid rich text root.')
  return { body: JSON.stringify(document), text: text.join(' ') }
}
