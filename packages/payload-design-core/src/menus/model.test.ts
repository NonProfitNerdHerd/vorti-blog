import { describe, expect, it } from 'vitest'
import {
  menuDepth,
  moveMenuBranch,
  orderedMenu,
  removeMenuItem,
  safeMenuURL,
  validateMenuItems,
  type MenuItem,
} from './model'
const link = (key: string, parent?: string): MenuItem => ({
  key,
  parent,
  label: key,
  kind: 'custom',
  url: `/${key}`,
})
describe('menu hierarchy and URL safety', () => {
  it('moves branches without detaching descendants and preserves sibling order', () => {
    const items = [link('a'), link('child', 'a'), link('b'), link('c')]
    const moved = moveMenuBranch(items, 'a', null, 'c')
    expect(moved.map((item) => item.key)).toEqual(['b', 'a', 'child', 'c'])
    expect(moveMenuBranch(items, 'a', 'child')).toBe(items)
    expect(moveMenuBranch(items, 'b', 'a').map((item) => item.key)).toEqual([
      'a',
      'child',
      'b',
      'c',
    ])
  })
  it('validates five levels, cycles, duplicate and missing parents, and malformed settings', () => {
    const items = Array.from({ length: 5 }, (_, index) =>
      link(`item${index}`, index ? `item${index - 1}` : undefined),
    )
    expect(validateMenuItems(items)).toBe(true)
    expect(menuDepth(items, 'item4')).toBe(5)
    expect(validateMenuItems([...items, link('six', 'item4')])).toMatch(/five/)
    expect(validateMenuItems([link('a', 'b'), link('b', 'a')])).toMatch(/cycles/)
    expect(validateMenuItems([link('a', 'missing')])).toMatch(/parent/)
    expect(validateMenuItems([link('a'), link('a')])).toMatch(/unique/)
    expect(validateMenuItems([{ ...link('a'), label: ' ' }])).toMatch(/label/)
  })
  it('can remove a row and promote its children, or remove the full branch', () => {
    const items = [link('a'), link('b', 'a'), link('c', 'b'), link('d')]
    expect(
      orderedMenu(removeMenuItem(items, 'a', false)).map((item) => [item.key, item.parent]),
    ).toEqual([
      ['b', null],
      ['c', 'b'],
      ['d', undefined],
    ])
    expect(removeMenuItem(items, 'a', true).map((item) => item.key)).toEqual(['d'])
  })
  it('permits supported link schemes and rejects script, credential, protocol-relative and control URLs', () => {
    for (const url of [
      'https://example.com/a?b=1#c',
      'http://example.com',
      '/about',
      '/',
      '#contact',
      'mailto:hello@example.com',
      'tel:+15551234567',
    ])
      expect(safeMenuURL(url), url).toBe(true)
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hello',
      '//example.com',
      '/\\evil.com',
      'https://u:p@example.com',
      '/bad\npath',
      'https://example.com/a b',
      '',
    ])
      expect(safeMenuURL(url), url).toBe(false)
  })
})
