'use client'
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { Viewport } from '../content/model'

export const InspectorDevice = createContext<{
  viewport: Viewport
  change: (device: Viewport) => void
} | null>(null)
export const InspectorGesture = { active: false, changed: false, pending: false }
export function markInspectorGesture() {
  InspectorGesture.pending = false
  if (InspectorGesture.active) InspectorGesture.changed = true
}
export function beginInspectorGesture() {
  InspectorGesture.pending = true
  InspectorGesture.active = true
  InspectorGesture.changed = false
}
export function endInspectorGesture() {
  InspectorGesture.active = false
  InspectorGesture.changed = false
}

export function InspectorIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    up: <path d="m6 10 6-6 6 6M12 4v16" />,
    down: <path d="m6 14 6 6 6-6M12 20V4" />,
    more: <><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>,
    undo: <path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12" />,
    redo: <path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12" />,
    inspector: <><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M15 3v18" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    layout: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <path d="M3 9h18M9 9v11" />
      </>
    ),
    style: <path d="m14 3 7 7-9 9-7-7zM5 12l-2 9 9-2M14 5l5 5" />,
    advanced: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3M16 8l3-3" />
      </>
    ),
    desktop: (
      <>
        <rect x="3" y="3" width="18" height="13" rx="1" />
        <path d="M12 16v5M7 21h10" />
      </>
    ),
    tablet: (
      <>
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    ),
    mobile: (
      <>
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    ),
    reset: (
      <>
        <path d="M4 10a8 8 0 1 1 1 8M4 3v7h7" />
      </>
    ),
    linked: (
      <path d="m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" />
    ),
    unlinked: <path d="m3 3 18 18M8 16l-1 1a4 4 0 0 1-6-6l3-3m12-1 1-1a4 4 0 0 1 6 6l-3 3" />,
    top: (
      <>
        <rect x="4" y="4" width="16" height="16" opacity=".3" />
        <path strokeWidth="4" d="M4 4h16" />
      </>
    ),
    right: (
      <>
        <rect x="4" y="4" width="16" height="16" opacity=".3" />
        <path strokeWidth="4" d="M20 4v16" />
      </>
    ),
    bottom: (
      <>
        <rect x="4" y="4" width="16" height="16" opacity=".3" />
        <path strokeWidth="4" d="M4 20h16" />
      </>
    ),
    left: (
      <>
        <rect x="4" y="4" width="16" height="16" opacity=".3" />
        <path strokeWidth="4" d="M4 4v16" />
      </>
    ),
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      {paths[name] ?? <path d="M4 6h16M4 12h10M4 18h16" />}
    </svg>
  )
}
export function IconButton({
  label,
  icon,
  onClick,
  pressed,
  disabled,
}: {
  label: string
  icon: string
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="inspector-icon"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <InspectorIcon name={icon} />
    </button>
  )
}
export function InspectorToggle({
  open,
  change,
}: {
  open: boolean
  change: (open: boolean) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        event.target instanceof Element &&
        (ref.current?.contains(event.target) ||
          event.target.closest('.content-workspace__right, .template-editor__sidebar--right')) &&
        ref.current?.getClientRects().length &&
        !document.querySelector('.inspector-popover')
      ) {
        event.preventDefault()
        event.stopPropagation()
        change(false)
        ref.current?.focus()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [open, change])
  return (
    <button
      ref={ref}
      type="button"
      className="inspector-toggle"
      aria-label="Toggle inspector"
      title={open ? 'Hide inspector' : 'Show inspector'}
      aria-expanded={open}
      aria-pressed={open}
      onClick={() => change(!open)}
    >
      <InspectorIcon name="inspector" />
    </button>
  )
}
export function Popover({
  label,
  trigger,
  children,
}: {
  label: string
  trigger: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ top: 0, left: 0 })
  const button = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    id = useId()
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = button.current!.getBoundingClientRect()
      setPosition({
        left: Math.max(8, Math.min(r.left, window.innerWidth - 280)),
        top: Math.max(
          8,
          Math.min(r.bottom + 4, window.innerHeight - (panel.current?.offsetHeight ?? 300) - 8),
        ),
      })
    }
    place()
    panel.current?.querySelector<HTMLElement>('input,button,select')?.focus()
    const outside = (e: PointerEvent) => {
      if (
        !(e.target as Element)?.closest?.('.inspector-popover') &&
        !panel.current?.contains(e.target as Node) &&
        !button.current?.contains(e.target as Node)
      ) {
        setOpen(false)
        button.current?.focus()
      }
    }
    const key = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        document
          .querySelectorAll('.inspector-popover')
          .item(document.querySelectorAll('.inspector-popover').length - 1) === panel.current
      ) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  return (
    <>
      <button
        ref={button}
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={panel}
            role="dialog"
            aria-label={label}
            className="inspector-popover"
            style={{ position: 'fixed', ...position }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}
export function DeviceControl({ label }: { label: string }) {
  const device = useContext(InspectorDevice)
  if (!device) return null
  return (
    <Popover label={`${label} device`} trigger={<InspectorIcon name={device.viewport} />}>
      <div className="inspector-segments">
        {(['desktop', 'tablet', 'mobile'] as const).map((value) => (
          <IconButton
            key={value}
            label={value === 'mobile' ? 'Phone' : value === 'desktop' ? 'Desktop' : 'Tablet'}
            icon={value}
            pressed={device.viewport === value}
            onClick={() => device.change(value)}
          />
        ))}
      </div>
    </Popover>
  )
}
export function DimensionControl({
  label,
  value,
  update,
  units = ['px', 'rem', 'em', '%', 'vh', 'vw'],
  negative = false,
}: {
  label: string
  value: string
  update: (v: string) => void
  units?: string[]
  negative?: boolean
}) {
  const [draft, setDraft] = useState(value),
    [previous, setPrevious] = useState(value)
  if (previous !== value) {
    setPrevious(value)
    setDraft(value)
  }
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|vh|vw)?$/.exec(value)
  const unit = match?.[2] ?? units[0] ?? '',
    number = Number(match?.[1] ?? 0)
  return (
    <div
      className="inspector-dimension"
      onPointerDown={beginInspectorGesture}
      onPointerUp={endInspectorGesture}
      onPointerCancel={endInspectorGesture}
      onFocus={beginInspectorGesture}
      onBlur={endInspectorGesture}
    >
      <input
        aria-label={`${label} slider`}
        type="range"
        min={negative ? -1000 : 0}
        max={unit === '%' ? 100 : unit === 'rem' || unit === 'em' ? 100 : 1000}
        step={unit === 'rem' || unit === 'em' ? 0.1 : 1}
        value={number}
        onChange={(e) => update(`${e.target.value}${unit}`)}
      />
      <input
        aria-label={label}
        value={
          draft && !/^(-?\d+(?:\.\d+)?)(px|rem|em|%|vh|vw)?$/.test(draft)
            ? draft
            : draft.replace(/(px|rem|em|%|vh|vw)$/, '')
        }
        placeholder="Inherit"
        onChange={(e) => {
          setDraft(e.target.value)
          if (
            e.target.value === '' ||
            /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)?$/.test(e.target.value) ||
            e.target.value === 'auto'
          )
            update(
              e.target.value === ''
                ? ''
                : /^-?\d+(\.\d+)?$/.test(e.target.value)
                  ? `${e.target.value}${unit}`
                  : e.target.value,
            )
        }}
        onBlur={() => setDraft(value)}
      />
      {units.length > 0 && (
        <Popover label={`${label} unit`} trigger={unit}>
          <div className="inspector-segments">
            {units.map((u) => (
              <button
                type="button"
                key={u}
                aria-pressed={unit === u}
                onClick={() => update(`${number}${u}`)}
              >
                {u}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}
