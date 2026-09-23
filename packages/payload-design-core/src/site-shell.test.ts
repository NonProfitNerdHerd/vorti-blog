import { describe, expect, it } from 'vitest'
import { validateAdditionalCSS, validateSiteShellNodes } from './site-shell'

describe('Site Shell contracts', () => {
  it('accepts independent, valid layout trees', () => {
    const header = [{ id: 'header-row', type: 'layout', layout: 'row', children: [{ id: 'logo', type: 'element', element: 'logo' }] }]
    const footer = [{ id: 'footer-stack', type: 'layout', layout: 'stack', children: [{ id: 'year', type: 'element', element: 'currentYear' }] }]
    expect(validateSiteShellNodes(header)).toBe(true)
    expect(validateSiteShellNodes(footer)).toBe(true)
    expect(header).not.toEqual(footer)
  })

  it('validates column structure and unique stable ids', () => {
    expect(validateSiteShellNodes([{ id: 'columns', type: 'layout', layout: 'columns', columns: [
      { id: 'left', width: 50, children: [] },
      { id: 'right', width: 50, children: [] },
    ] }])).toBe(true)
    expect(validateSiteShellNodes([{ id: 'columns', type: 'layout', layout: 'columns', columns: [{ id: 'left', width: 40, children: [] }] }])).toMatch('total 100')
    expect(validateSiteShellNodes([{ id: 'same', type: 'element', element: 'logo' }, { id: 'same', type: 'element', element: 'siteName' }])).toMatch('duplicated')
  })

  it('rejects content-template nodes from the Site Shell model', () => {
    expect(validateSiteShellNodes([{ id: 'field', type: 'field', fieldType: 'shortText' }])).toMatch('Unsupported Site Shell node type')
  })

  it('rejects unsafe or oversized CSS while allowing ordinary rules', () => {
    expect(validateAdditionalCSS('.site-header { display: grid; }')).toBe(true)
    expect(validateAdditionalCSS('@import url("https://example.com/style.css");')).toMatch('@import')
    expect(validateAdditionalCSS('</style><script>alert(1)</script>')).toMatch('style element')
    expect(validateAdditionalCSS('a'.repeat(50_001))).toMatch('50000')
  })
})
