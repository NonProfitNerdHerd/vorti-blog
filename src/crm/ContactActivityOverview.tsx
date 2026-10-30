'use client'
import { useEffect, useState } from 'react'
import type { Task } from '../review/client'
import type { ContactComment } from './comments'
import { crmRead } from './HouseholdWorkspace'

export type ActivityCreate = 'gift' | 'pledge' | 'recurring' | 'membership' | 'task' | 'volunteer' | 'communication'
type Capabilities = Partial<Record<ActivityCreate, boolean>>
type TaskPage = { docs: Task[]; canCreate: boolean }
type Relationships = { households: Array<{ id: string; name: string; ended_on: string | null }>; docs: Array<{ id: string; label: string; other_label: string }> }
type Comments = { docs: ContactComment[]; canPost: boolean }
const actions: Array<{ kind: ActivityCreate; label: string }> = [
  { kind: 'gift', label: 'Gift' }, { kind: 'pledge', label: 'Pledge' },
  { kind: 'recurring', label: 'Recurring schedule' }, { kind: 'membership', label: 'Membership' },
  { kind: 'task', label: 'Follow-up task' }, { kind: 'volunteer', label: 'Volunteer hours' },
  { kind: 'communication', label: 'Communication' },
]
export function ContactActivityOverview({ api, site, contact, onCreate, onOpen }: {
  api: string; site: string; contact: string;
  onCreate: (kind: ActivityCreate) => void;
  onOpen: (tab: 'tasks' | 'relationships' | 'comments') => void;
}) {
  const [tasks, setTasks] = useState<TaskPage | null>(null)
  const [relationships, setRelationships] = useState<Relationships | null>(null)
  const [comments, setComments] = useState<Comments | null>(null)
  const [permissions, setPermissions] = useState<Capabilities | null>(null)
  const [errors, setErrors] = useState<Partial<Record<'tasks' | 'relationships' | 'comments' | 'actions', string>>>({})
  const [refresh, setRefresh] = useState(0)
  const retry = () => { setErrors({}); setTasks(null); setRelationships(null); setComments(null); setPermissions(null); setRefresh(value => value + 1) }
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ site, contact })
    const taskQuery = new URLSearchParams({ site, type: 'contact', id: contact, view: 'upcoming' })
    const read = <T,>(url: string) => crmRead<T>(url, { signal: controller.signal })
    void read<TaskPage>(`${api}/crm/tasks?${taskQuery}`).then(value => {
      if (!controller.signal.aborted) setTasks(value)
    }).catch(() => { if (!controller.signal.aborted) setErrors(value => ({ ...value, tasks: 'Unable to load upcoming tasks.' })) })
    void read<Relationships>(`${api}/crm/households?${query}`).then(value => {
      if (!controller.signal.aborted) setRelationships(value)
    }).catch(() => { if (!controller.signal.aborted) setErrors(value => ({ ...value, relationships: 'Unable to load relationship details.' })) })
    void read<Comments>(`${api}/crm/comments?${query}`).then(value => {
      if (!controller.signal.aborted) setComments(value)
    }).catch(() => { if (!controller.signal.aborted) setErrors(value => ({ ...value, comments: 'Unable to load recent comment.' })) })
    const checks = [
      read<{ canEdit: boolean }>(`${api}/crm/finance?${new URLSearchParams({ site, constituent: contact, page: '1' })}`),
      read<{ canEdit: boolean }>(`${api}/crm/giving?${new URLSearchParams({ site, kind: 'pledge', contact })}`),
      read<{ canEdit: boolean }>(`${api}/crm/memberships?${new URLSearchParams({ site, contact, asOf: new Intl.DateTimeFormat('en-CA').format(new Date()) })}`),
      read<{ canEdit: boolean }>(`${api}/crm/volunteers?${new URLSearchParams({ site, view: 'hours', contact })}`),
      read<{ canEdit: boolean }>(`${api}/crm/activities?${query}`),
    ]
    void Promise.allSettled(checks).then(values => {
      if (controller.signal.aborted) return
      const allowed = (index: number) => values[index].status === 'fulfilled' && values[index].value.canEdit
      setPermissions({ gift: allowed(0), pledge: allowed(1), recurring: allowed(1), membership: allowed(2),
        volunteer: allowed(3), communication: allowed(4) })
      if (values.every(value => value.status === 'rejected')) setErrors(value => ({ ...value, actions: 'Unable to load available actions.' }))
    })
    return () => controller.abort()
  }, [api, site, contact, refresh])
  const permitted = { ...permissions, task: tasks?.canCreate || false }
  const available = actions.filter(action => permitted[action.kind])
  return <>
    <div className="vc-crm-activity-actions">
      <details className="vc-crm-add-activity">
        <summary className="vc-contact-button vc-contact-button--primary">＋ Add activity</summary>
        <div role="group" aria-label="Add activity type">
          {available.map(action => <button key={action.kind} type="button" onClick={event => {
            event.currentTarget.closest('details')?.removeAttribute('open')
            onCreate(action.kind)
          }}>{action.label}</button>)}
          {!available.length && <p>{permissions || tasks ? 'No available actions.' : 'Loading actions…'}</p>}
          {errors.actions && <button type="button" onClick={retry}>Retry actions</button>}
        </div>
      </details>
    </div>
    <aside className="vc-crm-activity-aside" aria-label="Constituent context">
      <section className="vc-crm-context-card">
        <div className="vc-crm-context-heading"><h3>Upcoming tasks</h3><button type="button" onClick={() => onOpen('tasks')}>View tasks</button></div>
        {errors.tasks ? <><p role="alert">{errors.tasks}</p><button type="button" onClick={retry}>Retry</button></> : !tasks ? <p role="status">Loading tasks…</p> :
          tasks.docs.length ? <ul>{tasks.docs.map(task => <li key={task.id}><strong>{task.title}</strong><span>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}{task.assigneeLabel ? ` · ${task.assigneeLabel}` : ''}</span></li>)}</ul>
            : <p>No upcoming tasks.</p>}
      </section>
      <section className="vc-crm-context-card">
        <div className="vc-crm-context-heading"><h3>Relationship details</h3><button type="button" onClick={() => onOpen('relationships')}>View relationships</button></div>
        {errors.relationships ? <><p role="alert">{errors.relationships}</p><button type="button" onClick={retry}>Retry</button></> : !relationships ? <p role="status">Loading relationships…</p> :
          relationships.households.some(item => !item.ended_on) || relationships.docs.length ? <dl>
            {relationships.households.filter(item => !item.ended_on).slice(0, 2).map(item => <div key={item.id}><dt>Household</dt><dd>{item.name}</dd></div>)}
            {relationships.docs.slice(0, 2).map(item => <div key={item.id}><dt>{item.label}</dt><dd>{item.other_label}</dd></div>)}
          </dl> : <p>No relationship details.</p>}
      </section>
      <section className="vc-crm-context-card">
        <div className="vc-crm-context-heading"><h3>Recent comment</h3><button type="button" onClick={() => onOpen('comments')}>View comments</button></div>
        {errors.comments ? <><p role="alert">{errors.comments}</p><button type="button" onClick={retry}>Retry</button></> : !comments ? <p role="status">Loading comments…</p> :
          comments.docs[0] ? <><p className="vc-crm-recent-comment">{comments.docs[0].body}</p><small>{comments.docs[0].author_label} · {new Date(comments.docs[0].created_at).toLocaleDateString()}</small></>
            : <p>No comments yet.</p>}
      </section>
    </aside>
  </>
}
