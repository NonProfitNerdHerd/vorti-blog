'use client'
import { useRef, useState } from 'react'
import { ContactActivities } from './ContactActivities'
import { RecordTasks } from './RecordTasks'

/** The constituent editor owns navigation/unload guards. Only one child editor
 * is mounted, so a saved call and its assigned follow-up share that guard. */
export function ContactFollowUps({
  api,
  admin,
  site,
  contact,
  onDirty,
  onSaving,
}: {
  api: string
  admin: string
  site: string
  contact: string
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
}) {
  return (
    <FollowUps key={`${site}:${contact}`} {...{ api, admin, site, contact, onDirty, onSaving }} />
  )
}
function FollowUps({
  api,
  admin,
  site,
  contact,
  onDirty,
  onSaving,
}: Parameters<typeof ContactFollowUps>[0]) {
  const [view, setView] = useState<'notes' | 'tasks'>('notes')
  const [source, setSource] = useState<{ id: string; subject: string } | null>(null)
  const dirty = useRef(false),
    busy = useRef(false)
  const changeDirty = (value: boolean) => {
    dirty.current = value
    onDirty(value)
  }
  const changeSaving = (value: boolean) => {
    busy.current = value
    onSaving(value)
  }
  const switchView = () => {
    if (
      busy.current ||
      (dirty.current &&
        !window.confirm('Discard unsaved changes before switching notes and follow-ups?'))
    )
      return
    changeDirty(false)
    setSource(null)
    setView(view === 'notes' ? 'tasks' : 'notes')
  }
  return (
    <section aria-label="Conversations and follow-ups">
      <button type="button" onClick={switchView}>
        {view === 'notes' ? 'Open follow-up tasks' : 'Back to notes and calls'}
      </button>
      {view === 'notes' ? (
        <ContactActivities
          api={api}
          site={site}
          contact={contact}
          onDirty={changeDirty}
          onSaving={changeSaving}
          onFollowUp={(activity) => {
            setSource(activity)
            setView('tasks')
          }}
        />
      ) : (
        <RecordTasks
          api={api}
          admin={admin}
          site={site}
          link={{ type: 'contact', id: contact }}
          activity={source?.id}
          defaultTitle={source?.subject || ''}
          onDirty={changeDirty}
          onSaving={changeSaving}
        />
      )}
    </section>
  )
}
