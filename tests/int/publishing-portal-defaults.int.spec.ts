import { expect, it } from 'vitest'
import { validateContentLayout, validateSiteShellNodes, walkContent } from '@design-system/payload-design-core'
import { intranetHomepageDefaults, intranetTemplateDefaults } from '@/publishing/portal-defaults'

it('uses the existing editable block and Site Template models for the internal portal', () => {
  const template = intranetTemplateDefaults(), layout = intranetHomepageDefaults('Fixture site', 42)
  expect(validateSiteShellNodes(template.header.layout)).toBe(true)
  expect(validateSiteShellNodes(template.footer.layout)).toBe(true)
  expect(validateContentLayout(layout)).toBe(true)
  expect(walkContent(layout.nodes).some(node => node.kind === 'postListing' && node.props?.collection === 'posts')).toBe(true)
  expect(walkContent(layout.nodes).some(node => node.kind === 'postListing' && node.props?.collection === 'pages' && node.props?.excludeIDs === '42')).toBe(true)
  expect(JSON.stringify(layout)).not.toMatch(/crm|tasks/i)
  expect(JSON.stringify(template)).toContain('Search Intranet')
})
