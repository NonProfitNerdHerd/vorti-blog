'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { usePublicFetch, SiteAnchor } from '../PublicSiteContext.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { paymentCurrencies } from './payment.js';
/** Payment-only bearer tokens remain in memory, never browser storage. */
export function PaymentPanel({ token }) {
    const publicFetch = usePublicFetch();
    const [view, setView] = useState(), [error, setError] = useState(''), [busy, setBusy] = useState(true);
    const heading = useRef(null), attempts = useRef({});
    const request = useCallback(async (operation, status, signal) => {
        const eventID = status ? (attempts.current[status] ||= crypto.randomUUID()) : undefined;
        try {
            const response = await publicFetch(`/api/forms-payments/${encodeURIComponent(token.split('.')[0])}`, {
                method: 'POST',
                credentials: 'same-origin',
                signal,
                headers: { 'Content-Type': 'application/json', 'X-Form-Payment': token },
                body: JSON.stringify({ operation, status, eventID }),
            });
            const body = (await response.json());
            if (!response.ok)
                throw new Error(body.message || 'Payment could not be updated. Your response remains saved; try again.');
            if (signal?.aborted)
                return;
            setView(body);
            if (status)
                delete attempts.current[status];
            if (operation === 'checkout') {
                const url = new URL(body.checkoutURL || '');
                if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com')
                    throw new Error('The provider returned an invalid checkout link.');
                window.location.assign(url.href);
            }
        }
        catch (failure) {
            if (!signal?.aborted)
                setError(failure instanceof Error ? failure.message : 'Payment is unavailable. Please retry.');
        }
        finally {
            if (!signal?.aborted)
                setBusy(false);
        }
    }, [token, publicFetch]);
    const act = (operation, status) => {
        setBusy(true);
        setError('');
        void request(operation, status);
    };
    useEffect(() => {
        const controller = new AbortController();
        // Defer the initial request until mount settles; Strict Mode cleanup cancels obsolete work.
        queueMicrotask(() => {
            if (!controller.signal.aborted)
                void request('status', undefined, controller.signal);
        });
        heading.current?.focus();
        return () => controller.abort();
    }, [request]);
    const amount = (value) => view
        ? new Intl.NumberFormat(undefined, { style: 'currency', currency: view.currency }).format(value / 10 ** paymentCurrencies[view.currency])
        : '';
    return (_jsxs("section", { className: "forms-runtime forms-payment", "aria-label": "Payment", "aria-busy": busy, children: [_jsx("h2", { ref: heading, tabIndex: -1, children: "Payment" }), _jsx("p", { children: "Your response is saved separately from payment. Actions requiring payment wait for verified success." }), view && (_jsxs(_Fragment, { children: [_jsx("p", { children: _jsx("strong", { children: view.simulated
                                ? 'Local simulator — no money is charged'
                                : 'Stripe test mode — no live payments' }) }), _jsxs("p", { children: [view.title, ": ", amount(view.amount)] }), _jsxs("p", { role: "status", children: ["Payment status: ", view.status, view.simulated && view.status === 'paid' ? ' (simulated)' : ''] }), view.refundedAmount > 0 && _jsxs("p", { children: ["Refunded: ", amount(view.refundedAmount)] }), view.message && _jsx("p", { children: view.message }), view.confirmation && _jsx("p", { children: view.confirmation }), view.status === 'paid' && view.continueURL && (_jsx("p", { children: _jsx(SiteAnchor, { href: view.continueURL, children: "Continue" }) })), !view.configured && _jsx("p", { children: "Payment provider: not configured." }), view.configured && !view.simulated && ['pending', 'failed'].includes(view.status) && (_jsx("button", { type: "button", disabled: busy, onClick: () => act('checkout'), children: "Continue to Stripe test checkout" })), view.configured && view.simulated && (_jsxs("fieldset", { disabled: busy, children: [_jsx("legend", { children: "Simulate a provider result" }), _jsx("div", { className: "forms-actions", children: ['paid', 'failed', 'canceled', 'refunded'].map((status) => (_jsxs("button", { type: "button", disabled: view.status === 'refunded' ||
                                        (status === 'refunded' ? view.status !== 'paid' : view.status === 'paid'), onClick: () => act('simulate', status), children: ["Simulate", ' ', status === 'paid' ? 'success' : status === 'refunded' ? 'refund' : status] }, status))) })] }))] })), error && _jsx("p", { role: "alert", children: error }), _jsx("button", { type: "button", disabled: busy, onClick: () => act('status'), children: busy ? 'Checking payment…' : 'Refresh payment status' })] }));
}
