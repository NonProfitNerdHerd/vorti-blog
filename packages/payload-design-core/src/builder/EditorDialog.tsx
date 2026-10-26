'use client'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import './editor-dialog.css'

/** Keeps inline controls mounted while expanding them into a centered editor. */
export function EditorDialog({
  open,
  inline = false,
  title,
  onClose,
  children,
  heading,
  topAligned = false,
}: {
  open: boolean
  inline?: boolean
  title: string
  onClose: () => void
  children: ReactNode
  heading?: ReactNode
  topAligned?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        Array.from(document.querySelectorAll('.editor-dialog-layer')).at(-1) !== ref.current
      )
        return
      if (
        event.target instanceof Element &&
        !ref.current?.contains(event.target) &&
        event.target.closest('.doc-drawer, [role="dialog"]')
      )
        return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      } else if (event.key === 'Tab' && event.target === document.body) {
        event.preventDefault()
        ref.current?.querySelector<HTMLElement>('[data-dialog-close]')?.focus()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, onClose])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('[data-dialog-close]')?.focus()
    return () => {
      document.body.style.overflow = overflow
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus()
      })
    }
  }, [open])
  if (!open && !inline) return null
  return (
    <div
      ref={ref}
      className={
        open
          ? `editor-dialog-layer${topAligned ? ' editor-dialog-top' : ''}`
          : 'editor-dialog-inline'
      }
      role={open ? 'dialog' : undefined}
      aria-modal={open ? true : undefined}
      aria-labelledby={open && !heading ? id : undefined}
      aria-label={open && heading ? title : undefined}
      onMouseDown={(event) => {
        if (open && event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (!open || event.defaultPrevented) return
        if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
        if (event.key === 'Tab') {
          const items = Array.from(
            ref.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
            ),
          ).filter((item) => item.getClientRects().length > 0 && !item.closest('[hidden], [inert]'))
          const first = items[0],
            last = items.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }
      }}
    >
      <div className={open ? 'editor-dialog-card' : undefined}>
        <header className="editor-dialog-heading" hidden={!open}>
          <div id={id} className="editor-dialog-title">
            {heading ?? <h2>{title}</h2>}
          </div>
          <button data-dialog-close type="button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className={open ? 'editor-dialog-content' : undefined}>{children}</div>
      </div>
    </div>
  )
}
