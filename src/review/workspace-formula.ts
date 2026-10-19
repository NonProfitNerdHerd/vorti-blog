import { calculate } from '@design-system/payload-design-core/forms'

type Primitive = string | number | boolean | null
type Value = Primitive | Primitive[]
type Node =
  | { kind: 'literal'; value: Value }
  | { kind: 'field'; id: string }
  | { kind: 'op'; op: string; a: Node; b: Node }
  | { kind: 'call'; name: string; args: Node[] }
const priorities: Record<string, number> = {
  '==': 1,
  '!=': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '+': 2,
  '-': 2,
  '*': 3,
  '/': 3,
  '%': 3,
}
const arity: Record<string, [number, number]> = {
  count: [1, 1],
  join: [1, 2],
  sum: [1, 100],
  min: [1, 100],
  max: [1, 100],
  round: [1, 2],
  abs: [1, 1],
  if: [3, 3],
  concat: [1, 30],
  lower: [1, 1],
  upper: [1, 1],
  length: [1, 1],
  days: [2, 2],
  adddays: [2, 2],
  hours: [1, 1],
}
export function parseWorkspaceFormula(source: string) {
  if (!source || source.length > 2000)
    throw new Error('Enter an expression of at most 2,000 characters.')
  const pattern =
    /\s*(\[(?:f\d+|n[a-zA-Z]+)\]|\d+(?:\.\d+)?|"(?:[^"\\]|\\["\\nrt])*"|[a-z]+|==|!=|>=|<=|[+\-*/%(),<>])/gy
  const tokens: string[] = []
  let position = 0
  while (position < source.trimEnd().length) {
    pattern.lastIndex = position
    const match = pattern.exec(source)
    if (!match) throw new Error(`Invalid expression near character ${position + 1}.`)
    tokens.push(match[1])
    position = pattern.lastIndex
    if (tokens.length > 300) throw new Error('Expression is too complex.')
  }
  let cursor = 0
  const parse = (level = 0, depth = 0): Node => {
    if (depth > 20) throw new Error('Expression nesting is too deep.')
    const token = tokens[cursor++]
    let node: Node
    if (token === '(') {
      node = parse(0, depth + 1)
      if (tokens[cursor++] !== ')') throw new Error('Missing closing parenthesis.')
    } else if (token === '-' || token === '+')
      node = { kind: 'op', op: token, a: { kind: 'literal', value: 0 }, b: parse(4, depth + 1) }
    else if (token?.startsWith('[')) node = { kind: 'field', id: token.slice(1, -1) }
    else if (token?.startsWith('"')) node = { kind: 'literal', value: JSON.parse(token) }
    else if (/^\d/.test(token ?? '')) node = { kind: 'literal', value: Number(token) }
    else if (arity[token] && tokens[cursor++] === '(') {
      const args: Node[] = []
      if (tokens[cursor] !== ')')
        do {
          args.push(parse(0, depth + 1))
        } while (tokens[cursor] === ',' && ++cursor)
      if (
        tokens[cursor++] !== ')' ||
        args.length < arity[token][0] ||
        args.length > arity[token][1]
      )
        throw new Error(`Invalid arguments for ${token}.`)
      node = { kind: 'call', name: token, args }
    } else throw new Error('Unknown function or value.')
    while ((priorities[tokens[cursor]] ?? 0) > level) {
      const op = tokens[cursor++]
      node = { kind: 'op', op, a: node, b: parse(priorities[op], depth + 1) }
    }
    return node
  }
  const tree = parse()
  if (cursor !== tokens.length) throw new Error('Unexpected expression value.')
  return tree
}
export function workspaceReferences(source: string) {
  const result = new Set<string>()
  const visit = (node: Node) => {
    if (node.kind === 'field') result.add(node.id)
    if (node.kind === 'op') {
      visit(node.a)
      visit(node.b)
    }
    if (node.kind === 'call') node.args.forEach(visit)
  }
  visit(parseWorkspaceFormula(source))
  return [...result]
}
export function workspaceFormula(source: string, values: Record<string, unknown>): Value {
  const number = (value: Value) => {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error('This operation requires numbers.')
    return value
  }
  const date = (value: Value) => {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    )
      throw new Error('This operation requires calendar dates.')
    return Date.parse(value + 'T12:00:00Z')
  }
  const evaluate = (node: Node): Value => {
    if (node.kind === 'literal') return node.value
    if (node.kind === 'field') {
      const value = values[node.id]
      if (Array.isArray(value)) {
        if (value.length > 1000) throw new Error('Formula collection is too large.')
        return value.map((item) => {
          if (item && typeof item === 'object' && typeof item.label === 'string')
            return item.label as string
          if (item === null || ['string', 'number', 'boolean'].includes(typeof item))
            return item as Primitive
          throw new Error('This collection requires supported scalar values.')
        })
      }
      if (
        value === undefined ||
        value === null ||
        !['string', 'number', 'boolean'].includes(typeof value)
      )
        throw new Error('A formula input is unavailable.')
      return value as Value
    }
    if (node.kind === 'op') {
      const a = evaluate(node.a),
        b = evaluate(node.b)
      if (Array.isArray(a) || Array.isArray(b))
        throw new Error(
          'This operation requires numbers or scalar values; use count or join for collections.',
        )
      if (node.op === '==') return a === b
      if (node.op === '!=') return a !== b
      return calculate(`[a]${node.op}[b]`, { a: number(a), b: number(b) })
    }
    if (node.name === 'if')
      return evaluate(node.args[0]) ? evaluate(node.args[1]) : evaluate(node.args[2])
    const args = node.args.map(evaluate)
    if (node.name === 'count') {
      if (!Array.isArray(args[0])) throw new Error('count requires a collection.')
      return args[0].length
    }
    if (node.name === 'join') {
      if (!Array.isArray(args[0])) throw new Error('join requires a collection.')
      return args[0].join(String(args[1] ?? ', ')).slice(0, 10000)
    }
    if (args.some(Array.isArray))
      throw new Error('Use count or join to convert a collection first.')
    if (node.name === 'concat') return args.map(String).join('').slice(0, 10000)
    if (node.name === 'lower') return String(args[0]).toLowerCase()
    if (node.name === 'upper') return String(args[0]).toUpperCase()
    if (node.name === 'length') return String(args[0]).length
    if (node.name === 'days') return (date(args[1]) - date(args[0])) / 86400000
    if (node.name === 'adddays')
      return new Date(date(args[0]) + number(args[1]) * 86400000).toISOString().slice(0, 10)
    if (node.name === 'hours') return number(args[0]) / 3600
    return calculate(
      `${node.name}(${args.map((_, index) => `[a${index}]`).join(',')})`,
      Object.fromEntries(args.map((value, index) => [`a${index}`, number(value)])),
    )
  }
  const result = evaluate(parseWorkspaceFormula(source))
  if (typeof result === 'number' && !Number.isFinite(result))
    throw new Error('Formula result must be finite.')
  return result
}
