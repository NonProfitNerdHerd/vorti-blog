'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { CRMOverview } from './overview'
import { formatMinor } from './money'

const overviewCache = new Map<string, CRMOverview>()

export function OverviewWorkspace({
  api,
  site,
  href,
  actor = '',
}: {
  api: string
  site: string
  href: (view: string) => string
  actor?: string
}) {
  const cacheKey = `${api}:${actor}:${site}`
  const [state, setState] = useState<{ data?: CRMOverview; error?: string }>(() => ({ data: overviewCache.get(cacheKey) })),
    [refresh, setRefresh] = useState(0),
    [currencyKey, setCurrencyKey] = useState('')
  useEffect(() => {
    if (!refresh && overviewCache.has(cacheKey)) return
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
        if (!controller.signal.aborted) { overviewCache.set(cacheKey, data); setState({ data }) }
      } catch (error) {
        if (!controller.signal.aborted) {
          overviewCache.delete(cacheKey)
          setState({
            error: error instanceof Error ? error.message : 'Unable to load the CRM overview.',
          })
        }
      }
    }
    if (site) void load()
    return () => controller.abort()
  }, [api, site, refresh, cacheKey])
  const data = state.data
  const cards = data ? [
    { label: 'Total contacts', value: data.contacts.total, view: 'contacts' },
    { label: 'New contacts this month', value: data.acquisition.newContactsThisMonth, view: 'contacts' },
    { label: 'Volunteers', value: data.contacts.volunteers, view: 'volunteers' },
    ...(data.donorMetrics ? [
      { label: 'Total donors', value: data.donorMetrics.total, view: 'donations' },
      { label: 'New donors this month', value: data.donorMetrics.newThisMonth, view: 'donations' },
      { label: 'New donors past 12 months', value: data.donorMetrics.newPast12Months, view: 'donations' },
      { label: 'Active recurring donors', value: data.donorMetrics.activeRecurring, view: 'giving' },
      { label: 'Donors with recurring history', value: data.donorMetrics.recurringHistory, view: 'giving' },
    ] : []),
  ] : []
  const selectedCurrency = data?.campaigns?.currencies.find((item) => `${item.currency}:${item.exponent}` === currencyKey) || data?.campaigns?.currencies[0]
  const campaignTotal = selectedCurrency?.rows.reduce((sum, row) => sum + BigInt(row.minorUnits), 0n) || 0n
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
              {data.followups.opportunities !== null && <Link className="vc-crm-due-tile" href={`${href('opportunities')}&openOnly=true&dueThrough=${encodeURIComponent(data.asOf)}`} aria-label={`${data.followups.opportunities} opportunity actions due today or overdue. View due opportunities`}>
                <strong>{data.followups.opportunities}</strong>
                <span>Opportunity actions due today or overdue</span>
              </Link>}
              <ul>
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
          {data.campaigns && <section className="vc-crm-overview-card vc-crm-campaigns" aria-label="Fiscal year to date campaign distribution">
            <header className="vc-crm-campaigns-heading"><div><h3>Fiscal YTD campaign distribution</h3><small>Since {data.campaigns.fiscalStart} through {data.asOf}</small></div><Link href={href('fundraising')}>Manage campaigns</Link></header>
            {data.campaigns.currencies.length ? <>
              <label>Currency{' '}<select aria-label="Campaign distribution currency" value={`${selectedCurrency?.currency}:${selectedCurrency?.exponent}`} onChange={(event) => setCurrencyKey(event.target.value)}>{data.campaigns.currencies.map((item) => <option key={`${item.currency}:${item.exponent}`} value={`${item.currency}:${item.exponent}`}>{item.currency}</option>)}</select></label>
              <div className="vc-crm-campaign-bars">{selectedCurrency?.rows.map((row) => {
                const percent = campaignTotal ? Number((BigInt(row.minorUnits) * 1000n + campaignTotal / 2n) / campaignTotal) / 10 : 0
                return <div className="vc-crm-campaign-row" key={row.id || 'other'}>
                  <span>{row.id ? <Link href={`${href('fundraising')}&resultType=campaigns&result=${encodeURIComponent(row.id)}`}>{row.name}</Link> : row.name}</span>
                  <div className="vc-crm-campaign-track" aria-label={`${row.name}: ${percent}%`}><span style={{ width: `${percent}%` }} /></div>
                  <strong>{percent}%</strong><span>{selectedCurrency.currency} {formatMinor(row.minorUnits, selectedCurrency.exponent)}</span>
                </div>
              })}</div>
            </> : <p>No campaign giving recorded for this fiscal year.</p>}
          </section>}
        </>
      )}
    </section>
  )
}
