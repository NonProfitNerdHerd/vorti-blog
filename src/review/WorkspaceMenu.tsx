'use client'
import { useId, useRef, useState, type ReactNode } from 'react'
export function WorkspaceMenu({
  label,
  trigger = '•••',
  children,
}: {
  label: string
  trigger?: ReactNode
  children: ReactNode
}) {
  const id = useId(),
    ref = useRef<HTMLDivElement>(null),
    [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="workspace-menu-trigger"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        popoverTarget={id}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          ref.current!.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - 280))}px`
          ref.current!.style.top = `${Math.min(bounds.bottom + 6, innerHeight / 2)}px`
        }}
      >
        {trigger}
      </button>
      <div
        ref={ref}
        id={id}
        popover="auto"
        className="workspace-popover-menu"
        aria-label={label}
        onToggle={(event) => {
          const shown = event.currentTarget.matches(':popover-open')
          setOpen(shown)
          if (shown) event.currentTarget.querySelector<HTMLButtonElement>('button')?.focus()
        }}
        onClick={(event) => {
          if ((event.target as Element).closest('button')) ref.current?.hidePopover()
        }}
      >
        {children}
      </div>
    </>
  )
}
