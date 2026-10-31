'use client'
import { useState } from 'react'
import { VolunteerProfiles } from './VolunteerProfiles'
import { VolunteerActivities } from './VolunteerActivities'
import { VolunteerHours } from './VolunteerHours'
import { useVolunteerGuard } from './useVolunteerIO'
export function VolunteerWorkspace({
  api,
  site,
  contact,
  initialView,
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  contact?: string
  initialView?: 'hours'
  onDirty?: (v: boolean) => void
  onSaving?: (v: boolean) => void
}) {
  const [view, setView] = useState<'profiles' | 'activities' | 'hours'>(initialView || 'profiles'),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false)
  const discard = useVolunteerGuard(dirty, busy, onDirty, onSaving)
  const navigate = (next: typeof view) => {
    if (next !== view && discard()) {
      setView(next)
      setDirty(false)
      setBusy(false)
    }
  }
  return (
    <section className="vc-crm-domain vc-crm-collection" aria-label="Volunteers">
      <h2>Volunteers</h2>
      <nav className="vc-crm-toolbar" aria-label="Volunteer sections">
        <button
          type="button"
          disabled={busy}
          aria-pressed={view === 'profiles'}
          onClick={() => navigate('profiles')}
        >
          Skills and discovery
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={view === 'activities'}
          onClick={() => navigate('activities')}
        >
          Chapter activities
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={view === 'hours'}
          onClick={() => navigate('hours')}
        >
          Hours and approvals
        </button>
      </nav>
      {view === 'profiles' ? (
        <VolunteerProfiles
          key={`${site}:${contact || ''}`}
          api={api}
          site={site}
          contact={contact}
          onDirty={setDirty}
          onSaving={setBusy}
        />
      ) : view === 'activities' ? (
        <VolunteerActivities
          key={`${site}:${contact || ''}`}
          api={api}
          site={site}
          contact={contact}
          onDirty={setDirty}
          onSaving={setBusy}
        />
      ) : (
        <VolunteerHours
          key={`${site}:${contact || ''}`}
          api={api}
          site={site}
          contact={contact}
          onDirty={setDirty}
          onSaving={setBusy}
        />
      )}
    </section>
  )
}
