'use client'
import { Tasks } from './Tasks'
import './tasks.css'
import Link from 'next/link'
import { useAuth, useConfig, useStepNav } from '@payloadcms/ui'
import { useRouter, useSearchParams } from 'next/navigation'
import { InboxBadge } from './WorkspaceInbox'
import { ProjectNavigator, ProjectSettings } from './WorkspaceProjects'
import { Plus } from './WorkspaceIcon'
import { useEffect, useState } from 'react'
import { reviewAPI } from './client'

function StarterWorkspace({ api, admin, active }: { api: string; admin: string; active: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    void reviewAPI(api, 'task-workspace/initialize', 'POST')
      .then(() => {
        if (!cancelled) setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [api, attempt])
  if (state !== 'ready')
    return (
      <div role={state === 'error' ? 'alert' : 'status'}>
        {state === 'error' ? (
          <>
            Could not prepare your workspace.{' '}
            <button
              type="button"
              onClick={() => {
                setState('loading')
                setAttempt((value) => value + 1)
              }}
            >
              Try again
            </button>
          </>
        ) : (
          'Preparing your workspace…'
        )}
      </div>
    )
  return (
    <div className="workspace-shell">
      <ProjectNavigator api={api} admin={admin} />
      <div className="workspace-main">
        <Tasks key={active} />
      </div>
    </div>
  )
}
export function TaskList() {
  const [creatingProject, setCreatingProject] = useState(false)
  const router = useRouter()
  const { setStepNav } = useStepNav()
  useEffect(() => {
    setStepNav([
      {
        label: (
          <span className="workspace-app-title">
            <span role="heading" aria-level={1}>
              Tasks
            </span>
            <span>Your work, connected</span>
          </span>
        ),
      },
    ])
    return () => setStepNav([])
  }, [setStepNav])
  const { user } = useAuth()
  const {
    config: {
      routes: { admin, api },
    },
  } = useConfig()
  const params = useSearchParams()
  const active = params.get('workspace') ?? (params.get('taskView') === 'assigned' ? 'mine' : 'all')
  const base = `${admin}/collections/review-tasks`
  return (
    <main className="review-global review-workspace">
      <nav className="task-workspace-tabs" aria-label="Tasks workspace">
        {[
          { key: 'mine', label: 'My tasks', href: `${base}?taskView=assigned` },
          { key: 'all', label: 'All tasks', href: base },
          { key: 'boards', label: 'Boards', href: `${base}?workspace=boards` },
          { key: 'inbox', label: 'Inbox', href: `${base}?workspace=inbox` },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active === tab.key ? 'page' : undefined}
          >
            {tab.label}
            {tab.key === 'inbox' && <InboxBadge api={api} />}
          </Link>
        ))}
        {user && (
          <button
            type="button"
            className="workspace-add-project"
            onClick={() => setCreatingProject(true)}
          >
            <Plus size={16} aria-hidden="true" /> Add project
          </button>
        )}
      </nav>
      {user && !user.username && (
        <p className="task-workspace-account-hint">
          <Link href={`${admin}/account`}>Set your username</Link> so teammates can @mention you.
          Your existing account and task access stay the same.
        </p>
      )}
      {user && <StarterWorkspace key={user.id} api={api} admin={admin} active={active} />}
      {creatingProject && (
        <ProjectSettings
          api={api}
          onClose={() => setCreatingProject(false)}
          onSaved={(project) => {
            setCreatingProject(false)
            window.dispatchEvent(new Event('vorti-tasks-changed'))
            const next = new URLSearchParams(params.toString())
            next.set('workspace', 'projects')
            next.set('project', String(project.id))
            next.delete('board')
            next.delete('boardFilter')
            router.push(`${base}?${next}`)
          }}
        />
      )}
    </main>
  )
}
