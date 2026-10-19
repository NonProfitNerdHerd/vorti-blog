'use client'
import { useEffect, useRef, useState } from 'react'

export function InlineTaskEntry({
  label,
  create,
  subtask = false,
}: {
  label: string
  create: (title: string) => Promise<void>
  subtask?: boolean
}) {
  const [title, setTitle] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const dirty = useRef(false),
    input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    dirty.current = !!title.trim()
  }, [title])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault()
    }
    const navigate = (event: MouseEvent) => {
      if (
        dirty.current &&
        (event.target as Element)?.closest?.('a[href]') &&
        !confirm('Discard this unsaved task title?')
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', navigate, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', navigate, true)
    }
  }, [])
  return (
    <div
      className={`workspace-inline-entry${subtask ? ' workspace-inline-subtask' : ''}`}
      onClick={() => input.current?.focus()}
    >
      <input
        ref={input}
        aria-label={label}
        placeholder={subtask ? '＋ Add subtask' : '＋ Add task'}
        maxLength={240}
        value={title}
        disabled={busy}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={async (event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            setTitle('')
            setError('')
            return
          }
          if (event.key !== 'Enter' || busy || !title.trim()) return
          event.preventDefault()
          setBusy(true)
          setError('')
          try {
            await create(title.trim())
            setTitle('')
          } catch (error) {
            setError((error as Error).message)
          } finally {
            setBusy(false)
            requestAnimationFrame(() => input.current?.focus())
          }
        }}
      />
      {busy && <span role="status">Saving…</span>}
      {error && <p role="alert">{error} Press Enter to retry.</p>}
    </div>
  )
}
