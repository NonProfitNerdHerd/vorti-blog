import { resizeHeight } from '../../packages/payload-design-core/src/forms/embed'

function mount() {
  document.querySelectorAll<HTMLIFrameElement>('iframe[data-vorti-form]').forEach(frame => {
    if (frame.dataset.vortiMounted) return
    let url: URL
    try { url = new URL(frame.src, window.location.href) } catch { return }
    if (!['https:', 'http:'].includes(url.protocol)) return
    const id = crypto.randomUUID()
    frame.dataset.vortiMounted = 'true'
    url.searchParams.set('parentOrigin', window.location.origin)
    url.searchParams.set('instance', id)
    frame.referrerPolicy = 'no-referrer'
    const receive = (event: MessageEvent) => {
      if (!frame.isConnected) { window.removeEventListener('message', receive); return }
      if (event.origin !== url.origin || event.source !== frame.contentWindow) return
      const height = resizeHeight(event.data, id)
      if (height !== undefined) frame.style.height = `${height}px`
    }
    window.addEventListener('message', receive)
    frame.src = url.href
  })
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
else mount()
