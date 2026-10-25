'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { CRMOverview } from './overview'

export function OverviewWorkspace({
  api,
  site,
  href,
}: {
  api: string
  site: string
  href: (view: string) => string
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
        const response = await fetch(`${api}/crm/overview?${new URLSearchParams({ site })}`, {
            cache: 'no-store',
            signal: controller.signal,
          }),
          data = (await response.json()) as CRMOverview & { message?: string }
        if (!response.ok) throw new Error(data.message || 'Unable to load the CRM overview.')
        if (!controller.signal.aborted) setState({ data })
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            error: error instanceof Error ? error.message : 'Unable to load the CRM overview.',
          })
      }
    }
    if (site) void load()
    return () => controller.abort()
  }, [api, site, refresh])
  const data = state.data
  const cards = data
    ? [
        {
          label: 'Constituents',
          value: data.contacts.total,
          description: 'People and organizations in this chapter',
          view: 'contacts',
        },
        {
          label: 'Donors',
          value: data.contacts.donors,
          description: 'Constituents with the donor role',
          view: 'contacts',
        },
        {
          label: 'Volunteers',
          value: data.contacts.volunteers,
          description: `${data.contacts.donorVolunteers} also have the donor role`,
          view: 'volunteers',
        },
      ]
    : []
  return (
    <section aria-label="CRM overview" className="vc-crm-domain">
      <header className="vc-crm-heading">
        <div>
          <h2>Your donor workspace</h2>
          <p>
            Understand your constituents, record their support and keep the next conversation
            moving.
          </p>
        </div>
        <button type="button" onClick={() => setRefresh((x) => x + 1)}>
          Refresh overview
        </button>
      </header>
      {state.error ? (
        <p role="alert">{state.error}</p>
      ) : !data ? (
        <p role="status">Loading chapter overview…</p>
      ) : (
        <>
          <div className="vc-crm-overview-cards">
            {cards.map((card) => (
              <Link
                key={card.label}
                href={href(card.view)}
                className="vc-crm-overview-card"
                aria-label={`${card.label}: ${card.value.toLocaleString()}`}
              >
                <span>{card.label}</span>
                <strong>{card.value.toLocaleString()}</strong>
                <small>{card.description}</small>
              </Link>
            ))}
          </div>
          <div className="vc-crm-overview-columns">
            <section className="vc-crm-overview-card">
              <h3>Received giving</h3>
              {data.received ? (
                <>
                  <p>
                    {data.received.gifts.toLocaleString()} posted monetary gifts across all dates
                  </p>
                  {data.received.currencies.length ? (
                    <dl>
                      {data.received.currencies.map((amount) => {
                        const digits = amount.minorUnits.padStart(amount.exponent + 1, '0')
                        return (
                          <div key={`${amount.currency}:${amount.exponent}`}>
                            <dt>{amount.currency}</dt>
                            <dd>
                              {amount.exponent
                                ? `${digits.slice(0, -amount.exponent)}.${digits.slice(-amount.exponent)}`
                                : digits}
                            </dd>
                          </div>
                        )
                      })}
                    </dl>
                  ) : (
                    <p>No monetary gifts recorded yet.</p>
                  )}
                  <p>
                    <small>
                      Net of refunds and corrections. Voids, in-kind gifts, pledges and expected
                      recurring payments are excluded.
                    </small>
                  </p>
                  <Link href={href('donations')}>Record or review donations</Link>
                </>
              ) : (
                <p>Received giving requires chapter finance access.</p>
              )}
            </section>
            <section className="vc-crm-overview-card">
              <h3>Follow-ups</h3>
              <ul>
                {data.followups.opportunities !== null && (
                  <li>
                    <Link href={href('opportunities')}>
                      {data.followups.opportunities} opportunity actions due today or overdue
                    </Link>
                  </li>
                )}
                {data.followups.membershipRenewals !== null && (
                  <li>
                    <Link href={href('memberships')}>
                      {data.followups.membershipRenewals} membership terms expire in the next 30
                      days
                    </Link>
                  </li>
                )}
                <li>
                  <Link href={href('correspondence')}>
                    Prepare receipts and thank-you correspondence
                  </Link>
                </li>
              </ul>
              <p>
                <small>
                  Counts cover the complete authorized chapter dataset as of {data.asOf} (UTC).
                </small>
              </p>
            </section>
          </div>
        </>
      )}
    </section>
  )
}
