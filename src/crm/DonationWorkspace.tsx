'use client'
import { useEffect, useState } from 'react'
import { ContactGifts } from './ContactGifts'
export function DonationWorkspace({ api, site }: { api: string; site: string }) {
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false)
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty || saving) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const navigate = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-vc-crm-navigation]')) return
      if (
        (dirty || saving) &&
        event.target instanceof Element &&
        event.target.closest('a[href]') &&
        (saving || !window.confirm('Discard unsaved gift changes?'))
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', before)
    document.addEventListener('click', navigate, true)
    return () => {
      window.removeEventListener('beforeunload', before)
      document.removeEventListener('click', navigate, true)
    }
  }, [dirty, saving])
  return (
    <section className="vc-crm-domain" aria-label="Donations">
      <h1>Donations</h1>
      <p>Record and reconcile support from every constituent in this chapter.</p>
      <ContactGifts api={api} site={site} contact="" onDirty={setDirty} onSaving={setSaving} />
    </section>
  )
}
