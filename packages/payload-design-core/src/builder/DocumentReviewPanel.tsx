'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { EditorHeaderPortal } from './EditorHeader'

/** Application-owned review UI; no persistence or permission decisions live here. */
export function DocumentReviewPanel({
  children,
  count,
  open,
  onOpenChange,
  disabled = false,
}: {
  children: ReactNode
  count: number
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled?: boolean
}) {
  const marker = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const [host, setHost] = useState<Element | null>(null)
  useEffect(() => {
    const locate = () => {
      const boundary = marker.current?.closest('.doc-drawer, [role="dialog"]') ?? null
      const scope = boundary ?? document
      const frame = Array.from(scope.querySelectorAll('.builder-frame')).find(
        (el) => el.closest('.doc-drawer, [role="dialog"]') === boundary,
      )
      setHost(frame ?? boundary ?? document.body)
    }
    locate()
    const observer = new MutationObserver(locate)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      onOpenChange(false)
      trigger.current?.focus()
    }
    window.addEventListener('keydown', escape, true)
    const inspect = (event: Event) => {
      if (
        (event as CustomEvent).detail.boundary !==
        (marker.current?.closest('.doc-drawer, [role="dialog"]') ?? null)
      )
        return
      event.preventDefault()
      onOpenChange(false)
    }
    window.addEventListener('editor:show-inspector', inspect)
    return () => {
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('editor:show-inspector', inspect)
    }
  }, [open, onOpenChange])
  return (
    <>
      <span ref={marker} hidden />
      <EditorHeaderPortal slot="actions" waitForTarget>
        <button
          ref={trigger}
          type="button"
          disabled={disabled}
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          Tasks ({count})
        </button>
      </EditorHeaderPortal>
      {open &&
        host &&
        createPortal(
          <aside
            ref={panel}
            tabIndex={-1}
            className={`document-review-panel ${host.classList.contains('builder-frame') ? '' : 'document-review-panel--floating'}`}
            aria-label="Document tasks"
          >
            <header>
              <strong>Tasks</strong>
              <button
                type="button"
                aria-label="Close tasks"
                onClick={() => {
                  onOpenChange(false)
                  trigger.current?.focus()
                }}
              >
                ×
              </button>
            </header>
            {children}
          </aside>,
          host,
        )}
    </>
  )
}
