'use client'
import { useEffect, useState } from 'react'
import { CorrespondenceTemplates } from './CorrespondenceTemplates'
import { CorrespondenceCompose } from './CorrespondenceCompose'
import { CorrespondenceHistory } from './CorrespondenceHistory'
import { EmailSettings } from './EmailSettings'
import { CorrespondenceBatchWorkspace } from './CorrespondenceBatchWorkspace'
type Props = {
  api: string
  site: string
  contact?: string
  onDirty?: (value: boolean) => void
  onSaving?: (value: boolean) => void
}
export function CorrespondenceWorkspace(props: Props) {
  return <Workspace key={`${props.api}:${props.site}:${props.contact || ''}`} {...props} />
}
function Workspace({ api, site, contact, onDirty, onSaving }: Props) {
  const [view, setView] = useState<'templates' | 'prepare' | 'history' | 'email' | 'batches'>(
      'history',
    ),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [correction, setCorrection] = useState<{ id: string; contact: string } | null>(null)
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    onSaving?.(busy)
  }, [busy, onSaving])
  const navigate = (next: typeof view) => {
    if (
      busy ||
      next === view ||
      (dirty && !window.confirm('Discard unsaved correspondence changes?'))
    )
      return
    setView(next)
    setDirty(false)
    setBusy(false)
    setCorrection(null)
  }
  return (
    <section className="vc-crm-domain" aria-label="Receipts and correspondence">
      <h2>Receipts and correspondence</h2>
      <nav className="vc-crm-toolbar" aria-label="Correspondence sections">
        {(
          [
            'history',
            'prepare',
            'templates',
            'email',
            ...(!contact ? ['batches' as const] : []),
          ] as const
        ).map((section) => (
          <button
            key={section}
            type="button"
            disabled={busy}
            aria-pressed={view === section}
            onClick={() => navigate(section)}
          >
            {section === 'history'
              ? 'Issued documents'
              : section === 'prepare'
                ? 'Prepare document'
                : section === 'email'
                  ? 'Email configuration'
                  : section === 'batches'
                    ? 'Bulk correspondence'
                    : 'Manage templates'}
          </button>
        ))}
      </nav>
      {view === 'batches' ? (
        <CorrespondenceBatchWorkspace
          api={api}
          site={site}
          onDirty={setDirty}
          onSaving={setBusy}
          onHistory={() => {
            setView('history')
            setDirty(false)
            setBusy(false)
            setCorrection(null)
          }}
        />
      ) : view === 'email' ? (
        <EmailSettings api={api} site={site} onDirty={setDirty} onSaving={setBusy} />
      ) : view === 'templates' ? (
        <CorrespondenceTemplates api={api} site={site} onDirty={setDirty} onSaving={setBusy} />
      ) : view === 'prepare' ? (
        <CorrespondenceCompose
          api={api}
          site={site}
          contact={correction?.contact || contact}
          supersedes={correction?.id}
          onDirty={setDirty}
          onSaving={setBusy}
          onIssued={() => setRefresh((value) => value + 1)}
        />
      ) : (
        <CorrespondenceHistory
          api={api}
          site={site}
          contact={contact}
          refresh={refresh}
          onDirty={setDirty}
          onSaving={setBusy}
          onCorrect={(id, person) => {
            setCorrection({ id, contact: person })
            setView('prepare')
            setDirty(false)
          }}
        />
      )}
    </section>
  )
}
