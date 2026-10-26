'use client'
import { useEffect, useRef, useState } from 'react'
import { reviewAPI } from './client'
import type { Mention } from './mentions'

type Person = { id: number; username: string; label: string }
export function MentionInput({
  api,
  taskID,
  scope,
  value,
  onChange,
  mentions = [],
  onMentions,
  label,
  disabled,
}: {
  api: string
  taskID?: number
  scope?: {
    board?: number
    parent?: number
    assignee?: number
    documentType?: string
    documentID?: string
  }
  value: string
  onChange: (text: string) => void
  mentions?: Mention[]
  onMentions: (mentions: Mention[]) => void
  label: string
  disabled?: boolean
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [cursor, setCursor] = useState(0)
  const [people, setPeople] = useState<Person[]>([])
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const match = /(?:^|[\s(\[{])@([a-zA-Z0-9._-]{0,32})$/.exec(value.slice(0, cursor))
  const search = match?.[1]
  const scopeQuery = new URLSearchParams(
    Object.fromEntries(
      Object.entries(scope ?? {})
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [key, String(value)]),
    ),
  ).toString()
  useEffect(() => {
    if (search === undefined || dismissed) return
    let current = true
    const timeout = setTimeout(() => {
      void reviewAPI<{ docs: Person[] }>(
        api,
        taskID
          ? `review-tasks/${taskID}/mentions?search=${encodeURIComponent(search)}`
          : `review-tasks/mention-candidates?${scopeQuery}&search=${encodeURIComponent(search)}`,
      )
        .then((r) => {
          if (current) {
            setPeople(r.docs)
            setActive(0)
          }
        })
        .catch(() => {
          if (current) setPeople([])
        })
    }, 150)
    return () => {
      current = false
      clearTimeout(timeout)
    }
  }, [api, taskID, scopeQuery, search, dismissed])
  const open = search !== undefined && !dismissed
  const choose = (person: Person) => {
    const start = cursor - search!.length - 1
    const text = `@${person.username}`
    const delta = text.length + 1 - (cursor - start)
    onMentions([
      ...mentions
        .filter((m) => m.end <= start || m.start >= cursor)
        .map((m) => (m.start >= cursor ? { ...m, start: m.start + delta, end: m.end + delta } : m)),
      { user: person.id, start, end: start + text.length, text },
    ])
    onChange(value.slice(0, start) + text + ' ' + value.slice(cursor))
    setDismissed(true)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(start + text.length + 1, start + text.length + 1)
    })
  }
  return (
    <div className="task-mention-input">
      <label>
        {label}
        <textarea
          rows={2}
          ref={input}
          aria-label={label}
          value={value}
          maxLength={20000}
          disabled={disabled}
          aria-autocomplete="list"
          aria-controls={open ? `mentions-${label.replace(/\s/g, '')}` : undefined}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onChange={(e) => {
            const text = e.target.value
            let start = 0
            while (start < Math.min(value.length, text.length) && value[start] === text[start])
              start++
            let end = value.length,
              nextEnd = text.length
            while (end > start && nextEnd > start && value[end - 1] === text[nextEnd - 1]) {
              end--
              nextEnd--
            }
            const delta = text.length - value.length
            onMentions(
              mentions
                .filter((m) => m.end <= start || m.start >= end)
                .map((m) =>
                  m.start >= end ? { ...m, start: m.start + delta, end: m.end + delta } : m,
                ),
            )
            setCursor(e.target.selectionStart)
            setDismissed(false)
            onChange(text)
          }}
          onKeyDown={(e) => {
            if (!open) return
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setDismissed(true)
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((old) =>
                Math.max(0, Math.min(people.length - 1, old + (e.key === 'ArrowDown' ? 1 : -1))),
              )
            }
            if (e.key === 'Enter' && people[active]) {
              e.preventDefault()
              choose(people[active])
            }
          }}
        />
      </label>
      {open && (
        <div
          className="task-mention-menu"
          id={`mentions-${label.replace(/\s/g, '')}`}
          role="listbox"
          aria-label="People who can access this task"
        >
          {people.map((person, i) => (
            <button
              type="button"
              role="option"
              aria-selected={active === i}
              key={person.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(person)}
            >
              @{person.username}
              <small>{person.label}</small>
            </button>
          ))}
          {!people.length && <p>No eligible usernames found.</p>}
        </div>
      )}
      <small>Type @ to mention someone with access. Mentions do not invite people.</small>
    </div>
  )
}
