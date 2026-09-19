import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRendererRegistry } from '../registry'
import { HeroBoardRenderer } from './HeroBoard'
import { heroBoardDesigns, heroBoardSample } from './registration'

const registry = createRendererRegistry({ 'hero-board': HeroBoardRenderer })

describe('trusted Hero Board renderer', () => {
  it('resolves by stable key and renders all four controlled variants', () => {
    const Renderer = registry.get('hero-board')
    for (const variant of heroBoardDesigns) {
      const html = renderToStaticMarkup(<Renderer design={variant.design} values={{ ...heroBoardSample, backgroundImage: { url: '/sample.jpg', alt: 'Sample landscape' }, foregroundImage: { url: '/sample.jpg', alt: 'Sample landscape' } }} />)
      expect(html).toContain('Example Hero Headline')
      expect(html).toContain(`hero-board--${variant.design.imageTreatment}`)
      expect(html).toContain('alt="Sample landscape"')
      expect(html).toContain('href="/example"')
    }
  })

  it('does not emit unsafe CTA destinations', () => {
    const html = renderToStaticMarkup(<HeroBoardRenderer design={heroBoardDesigns[0].design} values={{ headline: 'Safe', primaryCTA: { label: 'Unsafe', url: 'javascript:alert(1)' } }} />)
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('Unsafe')
  })
})
