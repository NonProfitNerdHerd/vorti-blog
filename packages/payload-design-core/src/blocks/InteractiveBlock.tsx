'use client'
import { Children, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ContentNode } from '../content/model'
import { safeURL, walkContent } from '../content/model'
import { EditingSelection } from './EditingSelection'
import { BlockIcon } from './Icons'
import { countdownDeadline } from './countdown'

export default function InteractiveBlock({
  node,
  children,
  editing = false,
  viewport,
}: {
  node: ContentNode
  children?: ReactNode
  editing?: boolean
  viewport?: 'desktop' | 'tablet' | 'mobile'
}) {
  const props = node.props ?? {}
  const [active, setActive] = useState(Number(props.initialPanel ?? 0))
  const [open, setOpen] = useState(Boolean(props.initialOpen))
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (editing || node.kind !== 'notification') return
    let frame = 0
    try {
      if (sessionStorage.getItem('block-notice:' + location.pathname + ':' + node.id))
        frame = requestAnimationFrame(() => setDismissed(true))
    } catch {
      /* Storage can be unavailable in private contexts. */
    }
    return () => cancelAnimationFrame(frame)
  }, [editing, node.kind, node.id])
  const [paused, setPaused] = useState(false)
  const [manuallyPaused, setManuallyPaused] = useState(false)
  const [count, setCount] = useState(Number(props.start ?? 0))
  const [now, setNow] = useState<number | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = Children.toArray(children)
  const [screen, setScreen] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  useEffect(() => {
    if (viewport || node.kind !== 'carousel' || typeof matchMedia !== 'function') return
    const mobile = matchMedia('(max-width:640px)'),
      tablet = matchMedia('(max-width:1024px)')
    const update = () =>
      setScreen(mobile.matches ? 'mobile' : tablet.matches ? 'tablet' : 'desktop')
    const frame = requestAnimationFrame(update)
    mobile.addEventListener?.('change', update)
    tablet.addEventListener?.('change', update)
    return () => {
      cancelAnimationFrame(frame)
      mobile.removeEventListener?.('change', update)
      tablet.removeEventListener?.('change', update)
    }
  }, [viewport, node.kind])
  const device = viewport ?? screen
  const visible = Math.min(
    items.length,
    Math.max(
      1,
      Number(
        props[
          device === 'mobile'
            ? 'mobileSlides'
            : device === 'tablet'
              ? 'tabletSlides'
              : 'slidesPerView'
        ] ?? 1,
      ),
    ),
  )
  const selectedSlide = Math.min(Math.max(0, active), Math.max(0, items.length - 1))
  const selected = useContext(EditingSelection)
  const accordion = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!editing || !selected) return
    const index =
      node.children?.findIndex((child) =>
        walkContent([child]).some((item) => item.id === selected),
      ) ?? -1
    if (index < 0) return
    const frame = requestAnimationFrame(() => {
      setActive(index)
      setOpen(true)
      const panel = accordion.current?.children[index]
      if (panel instanceof HTMLDetailsElement) panel.open = true
    })
    return () => cancelAnimationFrame(frame)
  }, [selected, editing, node.children])
  useEffect(() => {
    if (editing) return
    if (node.kind === 'countdown') {
      const timer = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(timer)
    }
    if (node.kind === 'countUp') {
      const end = Number(props.value ?? 100),
        start = Number(props.start ?? 0)
      if (
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        const frame = requestAnimationFrame(() => setCount(end))
        return () => cancelAnimationFrame(frame)
      }
      const began = performance.now(),
        duration = Math.max(0.1, Number(props.duration ?? 2)) * 1000
      let frame = 0
      const step = (time: number) => {
        const progress = Math.min(1, (time - began) / duration)
        setCount(Math.round(start + (end - start) * progress))
        if (progress < 1) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
      return () => cancelAnimationFrame(frame)
    }
    if (
      node.kind === 'carousel' &&
      props.autoplay &&
      !paused &&
      !manuallyPaused &&
      items.length > 1 &&
      !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    ) {
      const timer = setInterval(
        () =>
          setActive((value) =>
            props.loop === false
              ? Math.min(items.length - 1, value + 1)
              : (value + 1) % items.length,
          ),
        Math.max(2, Number(props.interval ?? 5)) * 1000,
      )
      return () => clearInterval(timer)
    }
  }, [
    editing,
    node.kind,
    props.value,
    props.start,
    props.duration,
    props.autoplay,
    props.interval,
    props.loop,
    paused,
    manuallyPaused,
    items.length,
  ])
  if (node.kind === 'notification')
    return dismissed ? null : (
      <aside role="status">
        {children}
        {!editing && props.dismissible !== false && (
          <button
            type="button"
            onClick={() => {
              setDismissed(true)
              try {
                sessionStorage.setItem('block-notice:' + location.pathname + ':' + node.id, '1')
              } catch {
                /* Dismissal still works without persistence. */
              }
            }}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        )}
      </aside>
    )
  if (node.kind === 'expand')
    return (
      <div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${node.id}-expanded`}
          onClick={() => setOpen(!open)}
        >
          {String(open ? (props.collapseLabel ?? 'Show less') : (props.label ?? 'Read more'))}
        </button>
        <div id={`${node.id}-expanded`} hidden={!open}>
          {children}
        </div>
      </div>
    )
  if (node.kind === 'accordion')
    return (
      <div ref={accordion}>
        {items.map((item, index) => (
          <details
            key={node.children?.[index]?.id ?? index}
            open={index === Number(props.initialPanel ?? -1)}
            name={props.multiple ? undefined : node.id}
          >
            <summary>{node.children?.[index]?.label || `Item ${index + 1}`}</summary>
            {item}
          </details>
        ))}
      </div>
    )
  if (node.kind === 'tabs')
    return (
      <div>
        <div
          role="tablist"
          aria-label={node.label || 'Tabs'}
          aria-orientation={node.variation?.id === 'vertical' ? 'vertical' : 'horizontal'}
        >
          {items.map((_, index) => (
            <button
              type="button"
              role="tab"
              id={`${node.id}-tab-${index}`}
              key={index}
              aria-selected={index === selectedSlide}
              aria-controls={`${node.id}-panel-${index}`}
              tabIndex={index === selectedSlide ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                const next =
                  event.key === (node.variation?.id === 'vertical' ? 'ArrowDown' : 'ArrowRight')
                    ? (selectedSlide + 1) % items.length
                    : event.key === (node.variation?.id === 'vertical' ? 'ArrowUp' : 'ArrowLeft')
                      ? (selectedSlide - 1 + items.length) % items.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? items.length - 1
                          : -1
                if (next >= 0) {
                  event.preventDefault()
                  setActive(next)
                  document.getElementById(`${node.id}-tab-${next}`)?.focus()
                }
              }}
            >
              {node.children?.[index]?.props?.tabIcon ? (
                <BlockIcon name={String(node.children[index].props?.tabIcon)} />
              ) : null}
              {node.children?.[index]?.label || `Tab ${index + 1}`}
            </button>
          ))}
        </div>
        {items.map((item, index) => (
          <div
            role="tabpanel"
            tabIndex={0}
            id={`${node.id}-panel-${index}`}
            aria-labelledby={`${node.id}-tab-${index}`}
            hidden={selectedSlide !== index}
            key={index}
          >
            {item}
          </div>
        ))}
      </div>
    )
  if (node.kind === 'carousel')
    return (
      <section
        data-carousel-transition={props.transition ?? 'none'}
        data-editing={editing}
        aria-roledescription="carousel"
        aria-label={node.label || 'Carousel'}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={(event) => {
          if (!event.currentTarget.contains(document.activeElement)) setPaused(false)
        }}
        onFocus={() => setPaused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
        }}
      >
        <div
          aria-live={paused || manuallyPaused || !props.autoplay || editing ? 'polite' : 'off'}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${visible || 1},minmax(0,1fr))`,
            gap: '16px',
          }}
        >
          {items.map((item, index) => (
            <div
              className="carousel-slide"
              style={{ order: (index - selectedSlide + items.length) % items.length }}
              key={index}
              hidden={
                props.loop === false
                  ? index < selectedSlide || index >= selectedSlide + visible
                  : (index - selectedSlide + items.length) % items.length >= visible
              }
              role="group"
              aria-label={`${index + 1} of ${items.length}`}
            >
              {item}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setActive((selectedSlide - 1 + items.length) % items.length)}
          disabled={items.length < 2 || (props.loop === false && selectedSlide === 0)}
        >
          Previous slide
        </button>
        <button
          type="button"
          onClick={() => setActive((selectedSlide + 1) % items.length)}
          disabled={items.length < 2 || (props.loop === false && selectedSlide >= items.length - 1)}
        >
          Next slide
        </button>
        {!!props.dots && (
          <div aria-label="Choose slide">
            {items.map((_, index) => (
              <button
                type="button"
                key={index}
                aria-label={`Go to slide ${index + 1}`}
                aria-pressed={selectedSlide === index}
                onClick={() => setActive(index)}
              >
                {index + 1}
              </button>
            ))}
          </div>
        )}
        {!!props.autoplay && !editing && (
          <button type="button" onClick={() => setManuallyPaused(!manuallyPaused)}>
            {manuallyPaused ? 'Play slides' : 'Pause slides'}
          </button>
        )}
      </section>
    )
  if (node.kind === 'countUp')
    return (
      <span>
        {String(props.prefix ?? '')}
        {editing ? Number(props.value ?? 100) : count}
        {String(props.suffix ?? '')}
      </span>
    )
  if (node.kind === 'countdown') {
    const deadline = countdownDeadline(
      String(props.deadline ?? ''),
      String(props.timezone ?? 'UTC'),
      String(props.recurrence ?? 'none'),
      now ?? Date.parse(String(props.deadline ?? '')) - 1,
    )
    if (!Number.isFinite(deadline)) return <span>Set a countdown deadline.</span>
    if (now === null) return <time dateTime={String(props.deadline)}>{String(props.deadline)}</time>
    const seconds = Math.max(0, Math.ceil((deadline - now) / 1000))
    return seconds ? (
      <span role="timer">
        {Math.floor(seconds / 86400)}d {Math.floor(seconds / 3600) % 24}h{' '}
        {Math.floor(seconds / 60) % 60}m {seconds % 60}s
      </span>
    ) : (
      <span>{String(props.completeText ?? 'The time has arrived')}</span>
    )
  }
  if (node.kind === 'videoPopup' || node.presentation?.link?.lightbox) {
    const url = safeURL(
      String(
        props.url ?? node.presentation?.link?.url ?? (node.media as { url?: string })?.url ?? '',
      ),
    )
    let embedded = ''
    try {
      const parsed = new URL(url)
      if (['youtube.com', 'www.youtube.com', 'youtu.be'].includes(parsed.hostname)) {
        const id =
          parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1) : parsed.searchParams.get('v')
        if (id && /^[\w-]+$/.test(id)) embedded = `https://www.youtube-nocookie.com/embed/${id}`
      } else if (
        ['vimeo.com', 'www.vimeo.com'].includes(parsed.hostname) &&
        /^\/\d+$/.test(parsed.pathname)
      )
        embedded = `https://player.vimeo.com/video${parsed.pathname}`
    } catch {
      /* Relative hosted media is also supported. */
    }
    return (
      <>
        <button
          ref={trigger}
          type="button"
          disabled={editing || !url}
          onClick={() => {
            setOpen(true)
            dialog.current?.showModal()
          }}
        >
          {children || String(props.label ?? 'Play video')}
        </button>
        <dialog
          ref={dialog}
          aria-label="Media viewer"
          onClose={() => {
            setOpen(false)
            trigger.current?.focus()
          }}
        >
          <button type="button" onClick={() => dialog.current?.close()}>
            Close media
          </button>
          {open &&
            (embedded ? (
              <iframe
                src={embedded}
                title="Video"
                allow="fullscreen"
                style={{ width: 'min(80vw, 960px)', aspectRatio: '16 / 9' }}
              />
            ) : node.kind === 'videoPopup' ? (
              <video src={url} controls style={{ maxWidth: '80vw' }} />
            ) : (
              children
            ))}
        </dialog>
      </>
    )
  }
  return <>{children}</>
}
