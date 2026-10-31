'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'

/** A native modal keeps focus inside the editor and restores it to its opener. */
export function CRMEditorDialog({ title, onDismiss, children }: {
  title: string
  onDismiss: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const titleID = useId()
  useEffect(() => {
    const element = dialog.current
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      opener.current?.focus()
    }
  }, [])
  return <dialog ref={dialog} className="vc-crm-editor-dialog" aria-labelledby={titleID}
    onCancel={event => { event.preventDefault(); onDismiss() }}>
    <div className="vc-crm-editor-dialog__head"><h2 id={titleID}>{title}</h2>
      <button type="button" aria-label={`Close ${title}`} onClick={onDismiss}>×</button></div>
    <div className="vc-crm-editor-dialog__body">{children}</div>
    <div className="vc-crm-editor-dialog__foot"><button type="button" onClick={onDismiss}>Cancel</button></div>
  </dialog>
}
