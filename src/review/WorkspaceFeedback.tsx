'use client'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import type { Task } from './client'
export function taskFeedback(
  task: Pick<Task, 'id' | 'title'>,
  action: 'created' | 'updated',
  view?: () => void,
) {
  window.dispatchEvent(
    new CustomEvent('vorti-task-feedback', {
      detail: { task, action, view, key: crypto.randomUUID() },
    }),
  )
}
export function WorkspaceFeedback() {
  const [notice, setNotice] = useState<{
    task: Task
    action: string
    view?: () => void
    key: string
  }>()
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>
    const show = (event: Event) => {
      clearTimeout(timeout)
      setNotice((event as CustomEvent).detail)
      timeout = setTimeout(() => setNotice(undefined), 5000)
    }
    window.addEventListener('vorti-task-feedback', show)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('vorti-task-feedback', show)
    }
  }, [])
  return notice
    ? createPortal(
        <div className="workspace-success-notice" role="status" aria-live="polite" key={notice.key}>
          <span>
            ✓ {notice.task.title} was {notice.action}.
          </span>
          {notice.view && (
            <button
              type="button"
              onClick={() => {
                notice.view?.()
                setNotice(undefined)
              }}
            >
              View task
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setNotice(undefined)}
          >
            ×
          </button>
        </div>,
        document.body,
      )
    : null
}
