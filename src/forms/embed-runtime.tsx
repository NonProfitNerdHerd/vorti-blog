import { createRoot } from 'react-dom/client'
import { FormHost } from '../../packages/payload-design-core/src/forms/FormHost'
import './embed.css'

const root = document.getElementById('form-root')
if (root?.dataset.slug) {
  createRoot(root).render(<FormHost slug={root.dataset.slug} embedded />)
  const parentOrigin = root.dataset.parentOrigin, id = root.dataset.instance
  if (parentOrigin && id && window.parent !== window) {
    let frame = 0, ready = false
    const resize = () => {
      // Keep the host's initial height while loading instead of collapsing it to a tiny placeholder.
      if (!ready && !root.querySelector('.forms-runtime, [aria-label="Form unavailable"]')) return
      ready = true
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => window.parent.postMessage({ type: 'vorti-form-resize', id, height: Math.ceil(root.getBoundingClientRect().height + 32) }, parentOrigin))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(root)
    window.addEventListener('pagehide', () => { observer.disconnect(); cancelAnimationFrame(frame) }, { once: true })
    resize()
  }
}
