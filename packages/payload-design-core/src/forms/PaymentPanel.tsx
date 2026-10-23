'use client'
import { usePublicFetch, SiteAnchor } from '../PublicSiteContext'
import { useCallback, useEffect, useRef, useState } from 'react'
import { paymentCurrencies, type PaymentView } from './payment'

/** Payment-only bearer tokens remain in memory, never browser storage. */
export function PaymentPanel({ token }: { token: string }) {
  const publicFetch = usePublicFetch()
  const [view, setView] = useState<PaymentView>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true)
  const heading = useRef<HTMLHeadingElement>(null),
    attempts = useRef<Record<string, string>>({})
  const request = useCallback(
    async (operation: string, status?: string, signal?: AbortSignal) => {
      const eventID = status ? (attempts.current[status] ||= crypto.randomUUID()) : undefined
      try {
        const response = await publicFetch(
          `/api/forms-payments/${encodeURIComponent(token.split('.')[0])}`,
          {
            method: 'POST',
            credentials: 'same-origin',
            signal,
            headers: { 'Content-Type': 'application/json', 'X-Form-Payment': token },
            body: JSON.stringify({ operation, status, eventID }),
          },
        )
        const body = (await response.json()) as PaymentView
        if (!response.ok)
          throw new Error(
            body.message || 'Payment could not be updated. Your response remains saved; try again.',
          )
        if (signal?.aborted) return
        setView(body)
        if (status) delete attempts.current[status]
        if (operation === 'checkout') {
          const url = new URL(body.checkoutURL || '')
          if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com')
            throw new Error('The provider returned an invalid checkout link.')
          window.location.assign(url.href)
        }
      } catch (failure) {
        if (!signal?.aborted)
          setError(
            failure instanceof Error ? failure.message : 'Payment is unavailable. Please retry.',
          )
      } finally {
        if (!signal?.aborted) setBusy(false)
      }
    },
    [token, publicFetch],
  )
  const act = (operation: string, status?: string) => {
    setBusy(true)
    setError('')
    void request(operation, status)
  }
  useEffect(() => {
    const controller = new AbortController()
    // Defer the initial request until mount settles; Strict Mode cleanup cancels obsolete work.
    queueMicrotask(() => {
      if (!controller.signal.aborted) void request('status', undefined, controller.signal)
    })
    heading.current?.focus()
    return () => controller.abort()
  }, [request])
  const amount = (value: number) =>
    view
      ? new Intl.NumberFormat(undefined, { style: 'currency', currency: view.currency }).format(
          value / 10 ** paymentCurrencies[view.currency],
        )
      : ''
  return (
    <section className="forms-runtime forms-payment" aria-label="Payment" aria-busy={busy}>
      <h2 ref={heading} tabIndex={-1}>
        Payment
      </h2>
      <p>
        Your response is saved separately from payment. Actions requiring payment wait for verified
        success.
      </p>
      {view && (
        <>
          <p>
            <strong>
              {view.simulated
                ? 'Local simulator — no money is charged'
                : 'Stripe test mode — no live payments'}
            </strong>
          </p>
          <p>
            {view.title}: {amount(view.amount)}
          </p>
          <p role="status">
            Payment status: {view.status}
            {view.simulated && view.status === 'paid' ? ' (simulated)' : ''}
          </p>
          {view.refundedAmount > 0 && <p>Refunded: {amount(view.refundedAmount)}</p>}
          {view.message && <p>{view.message}</p>}
          {view.confirmation && <p>{view.confirmation}</p>}
          {view.status === 'paid' && view.continueURL && (
            <p>
              <SiteAnchor href={view.continueURL}>Continue</SiteAnchor>
            </p>
          )}
          {!view.configured && <p>Payment provider: not configured.</p>}
          {view.configured && !view.simulated && ['pending', 'failed'].includes(view.status) && (
            <button type="button" disabled={busy} onClick={() => act('checkout')}>
              Continue to Stripe test checkout
            </button>
          )}
          {view.configured && view.simulated && (
            <fieldset disabled={busy}>
              <legend>Simulate a provider result</legend>
              <div className="forms-actions">
                {(['paid', 'failed', 'canceled', 'refunded'] as const).map((status) => (
                  <button
                    type="button"
                    key={status}
                    disabled={
                      view.status === 'refunded' ||
                      (status === 'refunded' ? view.status !== 'paid' : view.status === 'paid')
                    }
                    onClick={() => act('simulate', status)}
                  >
                    Simulate{' '}
                    {status === 'paid' ? 'success' : status === 'refunded' ? 'refund' : status}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => act('status')}>
        {busy ? 'Checking payment…' : 'Refresh payment status'}
      </button>
    </section>
  )
}
