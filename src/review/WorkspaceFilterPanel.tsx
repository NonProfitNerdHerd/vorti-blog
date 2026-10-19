'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { X } from './WorkspaceIcon'

export function WorkspaceFilterPanel({
  children,
  close,
}: {
  children: ReactNode
  close: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null),
    closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  }, [close])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current!
    const trigger = document.querySelector('[data-board-filter-trigger]')?.getBoundingClientRect()
    dialog.style.setProperty(
      '--filter-top',
      `${Math.min(trigger?.bottom ?? 80, innerHeight / 3) + 8}px`,
    )
    dialog.showModal()
    return () => {
      dialog.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="workspace-filter-panel"
      aria-label="Board filters"
      onCancel={(event) => {
        event.preventDefault()
        closeRef.current()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          closeRef.current()
      }}
    >
      <header>
        <h3>Filters and view options</h3>
        <button
          type="button"
          className="workspace-icon-control"
          aria-label="Close board filters"
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  )
}
