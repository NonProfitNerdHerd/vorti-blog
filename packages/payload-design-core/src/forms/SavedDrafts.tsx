'use client'
import { useEffect, useState } from 'react'
import { usePublicFetch } from '../PublicSiteContext'

interface Draft {
  id: number
  label: string
  expiresAt: string
  retiredAt?: string
}
interface DraftList {
  drafts: Draft[]
  next: number | null
  message?: string
}
export function SavedDrafts({
  slug,
  refresh,
  onResume,
  onRevoke,
}: {
  slug: string
  refresh: string
  onResume: (id: number) => Promise<boolean>
  onRevoke: (id: number) => Promise<string>
}) {
  const publicFetch = usePublicFetch()
  const [drafts, setDrafts] = useState<Draft[]>([]),
    [next, setNext] = useState<number | null>(null)
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/drafts`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) return
        if (!response.ok) throw new Error('Your account drafts could not be loaded.')
        const body = (await response.json()) as DraftList
        setDrafts(body.drafts)
        setNext(body.next)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message)
      })
    return () => controller.abort()
  }, [slug, refresh, publicFetch])
  if (!drafts.length && !message) return null
  return (
    <section aria-label="Your saved drafts">
      <h2>Your saved drafts</h2>
      <p>
        Resume replaces the answers currently on this page. Account drafts require your sign-in;
        resuming here ends the previous editing session.
      </p>
      <ul>
        {drafts.map((draft) => (
          <li key={draft.id}>
            <strong>{draft.label}</strong> — expires{' '}
            {new Date(draft.expiresAt).toLocaleDateString()}
            {draft.retiredAt ? (
              <span> This revision is retired. Contact the form owner for recovery.</span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const resumed = await onResume(draft.id)
                    setMessage(
                      resumed
                        ? 'Saved draft resumed.'
                        : 'Resume canceled. Your current answers are unchanged.',
                    )
                  } catch (error) {
                    setMessage((error as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Resume saved draft
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    `Revoke “${draft.label}”? Its private resume link will stop working.`,
                  )
                )
                  return
                setBusy(true)
                try {
                  const message = await onRevoke(draft.id)
                  setDrafts((items) => items.filter((item) => item.id !== draft.id))
                  setMessage(message)
                } catch (error) {
                  setMessage((error as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Revoke saved draft
            </button>
          </li>
        ))}
      </ul>
      {next !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const response = await publicFetch(
                `/api/forms-runtime/${encodeURIComponent(slug)}/drafts?after=${next}`,
              )
              const body = (await response.json()) as DraftList
              if (!response.ok) throw new Error(body.message)
              setDrafts((items) => [...items, ...body.drafts])
              setNext(body.next)
            } catch (error) {
              setMessage((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          More saved drafts
        </button>
      )}
      <p role="status">{message}</p>
    </section>
  )
}
