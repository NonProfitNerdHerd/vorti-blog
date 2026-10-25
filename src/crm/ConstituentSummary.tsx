'use client'
import { useEffect, useState } from 'react'
import type { CRMOverview } from './overview'
import { formatMinor } from './HouseholdWorkspace'
export type ConstituentSummaryAction =
  | 'gifts'
  | 'giving'
  | 'communications'
  | 'memberships'
  | 'relationships'
  | 'opportunities'
  | 'volunteers'
  | 'correspondence'
  | 'timeline'
/** The selected constituent's chapter summary shares the dashboard's exact
 * query, while each private domain remains independently authorized. */
export function ConstituentSummary({
  api,
  site,
  contact,
  roles,
  onOpen,
  onUnavailable,
}: {
  api: string
  site: string
  contact: string
  roles: string[]
  onOpen: (view: ConstituentSummaryAction) => void
  onUnavailable: () => void
}) {
  const [state, setState] = useState<{ data?: CRMOverview; error?: string }>({}),
    [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const focus = () => setRefresh((value) => value + 1)
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setState({})
      try {
        const response = await fetch(
            `${api}/crm/overview?${new URLSearchParams({ site, contact })}`,
            { cache: 'no-store', signal: controller.signal },
          ),
          data = (await response.json()) as CRMOverview & { message?: string }
        if (!response.ok) {
          if ([401, 403].includes(response.status) && !controller.signal.aborted) onUnavailable()
          throw new Error(data.message || 'Unable to load this constituent summary.')
        }
        if (!controller.signal.aborted) setState({ data })
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            error:
              error instanceof Error ? error.message : 'Unable to load this constituent summary.',
          })
      }
    }
    void load()
    return () => controller.abort()
  }, [api, site, contact, refresh, onUnavailable])
  const data = state.data
  return (
    <section className="vc-crm-constituent-summary" aria-label="Constituent summary">
      <div className="vc-crm-toolbar">
        <strong>Constituent at a glance</strong>
        <span>{roles.join(' · ') || 'contact'}</span>
        <button type="button" onClick={() => setRefresh((value) => value + 1)}>
          Refresh summary
        </button>
      </div>
      {state.error ? (
        <p role="alert">{state.error}</p>
      ) : !data ? (
        <p role="status">Loading constituent summary…</p>
      ) : (
        <div className="vc-crm-overview-cards">
          <section>
            <h3>Received support</h3>
            {data.received ? (
              <>
                <p>{data.received.gifts} posted monetary gifts</p>
                {data.received.currencies.map((amount) => (
                  <p key={`${amount.currency}:${amount.exponent}`}>
                    <strong>
                      {amount.currency} {formatMinor(amount.minorUnits, amount.exponent)}
                    </strong>
                  </p>
                ))}
                <small>Net received, all dates. In-kind gifts and commitments are separate.</small>
                <div className="vc-crm-toolbar">
                  <button type="button" onClick={() => onOpen('gifts')}>
                    View or record gifts
                  </button>
                  <button type="button" onClick={() => onOpen('giving')}>
                    View pledges and recurring giving
                  </button>
                </div>
              </>
            ) : (
              <p>Finance access is required to view giving.</p>
            )}
          </section>
          <section>
            <h3>Next conversations</h3>
            {data.followups.opportunities !== null ? (
              <div>
                <p>{data.followups.opportunities} opportunity actions due</p>
                <button type="button" onClick={() => onOpen('opportunities')}>
                  Review opportunities
                </button>
              </div>
            ) : (
              <p>Opportunity access is required.</p>
            )}
            {data.followups.membershipRenewals !== null && (
              <div>
                <p>{data.followups.membershipRenewals} membership renewals within 30 days</p>
                <button type="button" onClick={() => onOpen('memberships')}>
                  Review memberships and renewals
                </button>
              </div>
            )}
            <button type="button" onClick={() => onOpen('communications')}>
              Record a call or note
            </button>
          </section>
          <section>
            <h3>Constituent history</h3>
            <p>Donor, volunteer and member activity stays connected to this constituent.</p>
            <button type="button" onClick={() => onOpen('timeline')}>
              Open timeline
            </button>
            <button type="button" onClick={() => onOpen('correspondence')}>
              Thank this constituent
            </button>
          </section>
        </div>
      )}
    </section>
  )
}
