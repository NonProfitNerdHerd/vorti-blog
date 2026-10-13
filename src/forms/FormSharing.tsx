'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'

const attribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
export function FormSharing({ formID, published }: { formID: string | number; published?: unknown }) {
  const [links, setLinks] = useState<{ url: string; embed: string; qr: string; title: string }>()
  const [message, setMessage] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/forms-placement/${encodeURIComponent(formID)}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Publish this form before sharing it. Archived forms cannot be shared.')
      const form = await response.json() as { slug: string; title: string }
      const url = new URL(`/forms/${encodeURIComponent(form.slug)}`, window.location.origin).href
      const frame = new URL(`/api/forms-embed/${encodeURIComponent(form.slug)}`, window.location.origin).href
      if (controller.signal.aborted) return
      setLinks({ url, qr: '', title: form.title, embed: `<iframe data-vorti-form src="${attribute(frame)}" title="${attribute(form.title)}" width="100%" height="600" style="border:0" referrerpolicy="no-referrer"></iframe>\n<script src="${attribute(window.location.origin)}/forms-assets/loader.js" defer></script>` }); setMessage('')
      try {
        const qr = await (await import('qrcode')).toDataURL(url, { width: 320, margin: 4, errorCorrectionLevel: 'M' })
        if (!controller.signal.aborted) setLinks(previous => previous?.url === url ? { ...previous, qr } : previous)
      } catch { if (!controller.signal.aborted) setMessage('The QR code could not be generated. You can still use the share link and embed code.') }
    }).catch(error => { if (!controller.signal.aborted) { setLinks(undefined); setMessage(error.message) } })
    return () => controller.abort()
  }, [formID, published])
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setMessage('Copied.') }
    catch { setMessage('Select the text and copy it with your keyboard.') }
  }
  return <section aria-label="Share form"><h3>Share your published form</h3><p>Links use the published form, including after you save draft changes. For pages in this site, insert the Form block.</p>
    {links && <><label>Share link<input readOnly value={links.url} onFocus={event => event.target.select()} /></label><button type="button" onClick={() => void copy(links.url)}>Copy share link</button> <a href={links.url} target="_blank" rel="noopener noreferrer">Open published form</a>
      {links.qr ? <figure><Image src={links.qr} alt={`QR code for ${links.title}`} width={240} height={240} unoptimized /><figcaption><a href={links.qr} download={`form-${formID}-qr.png`}>Download QR code</a></figcaption></figure> : <p>Preparing QR code…</p>}
      <label>Iframe embed code<textarea readOnly rows={5} value={links.embed} onFocus={event => event.target.select()} /></label><button type="button" onClick={() => void copy(links.embed)}>Copy embed code</button>
      <p>Add the hosting website’s exact HTTPS origin in Access → Allowed iframe hosts, then publish. The loader resizes only its own frame after validating the message origin and instance. Sign-in-required forms may need visitors to open the standalone page when browsers block third-party cookies.</p></>}
    <p role="status">{message || (!links ? 'Loading sharing options…' : '')}</p>
  </section>
}
