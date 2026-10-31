'use client'
import { useEffect, useState } from 'react'
import { Gutter, useConfig } from '@payloadcms/ui'
import { crmRecordLink } from './record-model'
import { RecordTasks } from './RecordTasks'

export function RecordTaskPage(props: { site: string; type: string | null; id: string | null }) {
  return <RecordFollowUps key={`${props.site}:${props.type}:${props.id}`} {...props} />
}
function RecordFollowUps({ site, type, id }: Parameters<typeof RecordTaskPage>[0]) {
  const { config } = useConfig()
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, busy])
  let link
  try {
    link = crmRecordLink(type, id)
  } catch {
    return (
      <Gutter>
        <p role="alert">Choose a valid CRM record to open its follow-up tasks.</p>
      </Gutter>
    )
  }
  return (
    <Gutter className="vc-crm">
      <h1>{type === 'contact' ? 'Contact' : type?.replaceAll('-', ' ')} tasks</h1>
      <p>
        This tab is pinned to the record and chapter in its address. Your original editor remains
        open.
      </p>
      <p>
        <a
          href={`${config.routes.admin}/crm?${new URLSearchParams({ site })}`}
          onClick={(event) => {
            if (busy || (dirty && !window.confirm('Discard unsaved follow-up changes?')))
              event.preventDefault()
          }}
        >
          Open CRM workspace
        </a>
      </p>
      <RecordTasks
        api={config.routes.api}
        admin={config.routes.admin}
        site={site}
        link={link}
        onDirty={setDirty}
        onSaving={setBusy}
      />
    </Gutter>
  )
}
