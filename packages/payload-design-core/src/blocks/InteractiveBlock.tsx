'use client'
import { Children, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ContentNode } from '../content/model'
import { safeURL } from '../content/model'

export default function InteractiveBlock({
  node,
  children,
  editing = false,
}: {
  node: ContentNode
  children?: ReactNode
  editing?: boolean
}) {
  const props = node.props ?? {}
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [count, setCount] = useState(Number(props.start ?? 0))
  const [now, setNow] = useState<number | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = Children.toArray(children)
  useEffect(() => {
    if (editing) return
    if (node.kind === 'countdown') {
      const timer = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(timer)
    }
    if (node.kind === 'countUp') {
      const end = Number(props.value ?? 100),
        start = Number(props.start ?? 0)
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
      items.length > 1 &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const timer = setInterval(
        () => setActive((value) => (value + 1) % items.length),
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
    paused,
    items.length,
  ])
  if (editing && ['accordion', 'tabs', 'carousel', 'expand', 'notification'].includes(node.kind))
    return <div>{children}</div>
  if (node.kind === 'notification')
    return dismissed ? null : (
      <aside role="status">
        {children}
        {props.dismissible !== false && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
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
      <div>
        {items.map((item, index) => (
          <details key={index} name={props.multiple ? undefined : node.id}>
            <summary>{node.children?.[index]?.label || `Item ${index + 1}`}</summary>
            {item}
          </details>
        ))}
      </div>
    )
  if (node.kind === 'tabs')
    return (
      <div>
        <div role="tablist" aria-label={node.label || 'Tabs'}>
          {items.map((_, index) => (
            <button
              type="button"
              role="tab"
              id={`${node.id}-tab-${index}`}
              key={index}
              aria-selected={index === active}
              aria-controls={`${node.id}-panel-${index}`}
              tabIndex={index === active ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                const next =
                  event.key === 'ArrowRight'
                    ? (active + 1) % items.length
                    : event.key === 'ArrowLeft'
                      ? (active - 1 + items.length) % items.length
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
            hidden={active !== index}
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
        aria-roledescription="carousel"
        aria-label={node.label || 'Carousel'}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
      >
        <div aria-live={paused || !props.autoplay ? 'polite' : 'off'}>
          {items.map((item, index) => (
            <div
              key={index}
              hidden={index !== active}
              role="group"
              aria-label={`${index + 1} of ${items.length}`}
            >
              {item}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setActive((active - 1 + items.length) % items.length)}
          disabled={items.length < 2}
        >
          Previous slide
        </button>
        <button
          type="button"
          onClick={() => setActive((active + 1) % items.length)}
          disabled={items.length < 2}
        >
          Next slide
        </button>
        {!!props.autoplay && (
          <button type="button" onClick={() => setPaused(!paused)}>
            {paused ? 'Play slides' : 'Pause slides'}
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
    const deadline = Date.parse(String(props.deadline ?? ''))
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
