import { it, expect } from 'vitest'
import { renderToPipeableStream } from 'react-dom/server'
import { PassThrough } from 'node:stream'
import type { ReactNode } from 'react'
let renderNumber = 0
const renderMarkup = (element: ReactNode) =>
  new Promise<string>((resolve, reject) => {
    const output = new PassThrough()
    let html = ''
    output.on('data', (chunk) => {
      html += chunk
    })
    output.on('end', () => resolve(html))
    const stream = renderToPipeableStream(element, {
      identifierPrefix: `review-${renderNumber++}-`,
      onAllReady() {
        stream.pipe(output)
      },
      onError: reject,
    })
  })
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { listBlockDefinitions } from './registry'
import { createContentNode, walkContent } from '../content/model'
import { applyVariation } from './variations'
import { ContentRenderer } from '../content/ContentRenderer'

it('renders a review fixture for every registered layout family', async () => {
  const families = listBlockDefinitions().filter((definition) => definition.variations?.length)
  const body = (
    await Promise.all(
      families.map(
        async (definition) =>
          `<section data-family="${definition.type}"><h1>${definition.label}</h1>${(
            await Promise.all(
              definition.variations!.map(async (variation) => {
                const node = applyVariation(createContentNode(definition.type), variation.id)
                if (node.kind === 'notification')
                  node.children = [
                    { ...createContentNode('paragraph'), text: 'Your update has been saved.' },
                  ]
                if (node.kind === 'quote') node.text = 'Good design makes the next step clear.'
                if (node.kind === 'socialButtons')
                  node.props = {
                    ...node.props,
                    links: [
                      { label: 'Community', url: 'https://example.com', icon: 'users' },
                      { label: 'Website', url: 'https://example.org', icon: 'globe' },
                    ],
                  }
                for (const child of walkContent([node]))
                  if (child.kind === 'image')
                    child.media = {
                      url: '/review-image.svg',
                      alt: 'Geometric landscape',
                      width: 800,
                      height: 500,
                    }
                if (node.kind === 'postListing')
                  node.props = {
                    ...node.props,
                    results: [
                      {
                        title: 'A useful article',
                        excerpt: 'Review the layout, image treatment, and metadata.',
                        image: '/review-image.svg',
                        url: '#',
                        publishedAt: '2026-10-11',
                        taxonomy: ['News'],
                      },
                      {
                        title: 'Another article',
                        excerpt: 'A second listing item.',
                        image: '/review-image.svg',
                        url: '#',
                      },
                    ],
                  }
                const html = await renderMarkup(<ContentRenderer nodes={[node]} />)
                expect(html).not.toContain('Loading listing')
                expect(html).toContain(`data-variation="${variation.id}"`)
                return `<article class="review-example"><h2>${variation.label}</h2>${html}</article>`
              }),
            )
          ).join('')}</section>`,
      ),
    )
  ).join('')
  if (process.env.BLOCK_REVIEW_PATH) {
    const dir = resolve(process.env.BLOCK_REVIEW_PATH)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      resolve(dir, 'block-layouts.html'),
      `<!doctype html><html><meta charset="utf-8"><title>Block layout review</title><style>${readFileSync(new URL('./variations.css', import.meta.url), 'utf8')}*{box-sizing:border-box}body{font:16px/1.5 system-ui;margin:0;padding:20px;background:var(--theme-bg);color:var(--theme-text);--theme-bg:white;--theme-text:#17212e}.review-example{border:1px solid #8886;margin:20px 0;padding:16px}section[data-family]{max-width:1100px;margin:auto}img{max-width:100%}h1,h2,h3,p{overflow-wrap:anywhere}.content-button{display:inline-block;padding:10px 20px;background:#3858e9;color:white;border-radius:4px}body.dark{--theme-bg:#171b22;--theme-text:#f4f5f7}body:not(.all) section[data-family]{display:none}body:not(.all) section[data-family].active{display:block}</style><body class="all">${body.replaceAll('/review-image.svg', 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 800 500%22%3E%3Crect width=%22800%22 height=%22500%22 fill=%22%2394bbcb%22/%3E%3Ccircle cx=%22590%22 cy=%22140%22 r=%2270%22 fill=%22%23f2dfad%22/%3E%3Cpath d=%22M0 500L240 120L500 500 M250 500L570 200L800 500%22 fill=%22%2335615a%22/%3E%3C/svg%3E')}<script>const family=new URLSearchParams(location.search).get('family');if(family){document.body.classList.remove('all');document.querySelector('[data-family="'+family+'"]')?.classList.add('active')}if(new URLSearchParams(location.search).has('dark'))document.body.classList.add('dark')</script></body></html>`,
    )
  }
})
