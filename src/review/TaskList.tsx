'use client'
import { Tasks } from './Tasks'
import './tasks.css'
import Link from 'next/link'
import { useAuth, useConfig } from '@payloadcms/ui'
import { useSearchParams } from 'next/navigation'
import { InboxBadge } from './WorkspaceInbox'
import { ProjectNavigator } from './WorkspaceProjects'
export function TaskList() {
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
      <header className="task-dashboard-heading">
        <div>
          <p>Your work, connected</p>
          <h1>Tasks</h1>
        </div>
        <span>Keep your site’s next steps in view.</span>
      </header>
      <nav className="task-workspace-tabs" aria-label="Tasks workspace">
        {[
          { key: 'mine', label: 'My tasks', href: `${base}?taskView=assigned` },
          { key: 'all', label: 'All tasks', href: base },
          { key: 'projects', label: 'Projects', href: `${base}?workspace=projects` },
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
      </nav>
      {user && !user.username && (
        <p className="task-workspace-account-hint">
          <Link href={`${admin}/account`}>Set your username</Link> so teammates can @mention you.
          Your existing account and task access stay the same.
        </p>
      )}
      <div className="workspace-shell"><ProjectNavigator api={api} admin={admin}/><div className="workspace-main"><Tasks key={active} /></div></div>
    </main>
  )
}
