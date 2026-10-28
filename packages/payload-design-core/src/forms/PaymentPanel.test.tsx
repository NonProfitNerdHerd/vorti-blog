// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PaymentPanel } from './PaymentPanel'
import { PaymentSettings } from './PaymentSettings'
import { emptyDefinition } from './model'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const pending = { title: 'Test order', amount: 2500, currency: 'USD', provider: 'simulator', status: 'pending', refundedAmount: 0, simulated: true, configured: true }
describe('payment experience', () => {
  it('labels simulation, keeps retry event IDs, and offers refund only after success', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(pending))
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValueOnce(Response.json({ ...pending, status: 'paid' }))
      .mockResolvedValueOnce(Response.json({ ...pending, status: 'refunded', refundedAmount: 2500 }))
    vi.stubGlobal('fetch', fetcher)
    render(<PaymentPanel token="submission.expiry.signature" />)
    await screen.findByText('Local simulator — no money is charged')
    expect((screen.getByRole('button', { name: 'Simulate refund' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Simulate success' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Simulate success' }))
    await screen.findByText('Payment status: paid (simulated)')
    expect(JSON.parse(fetcher.mock.calls[1][1].body).eventID).toBe(JSON.parse(fetcher.mock.calls[2][1].body).eventID)
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('X-Form-Payment')).toBe('submission.expiry.signature')
    expect(fetcher.mock.calls[0][0]).toBe('/api/forms-payments/submission')
    fireEvent.click(screen.getByRole('button', { name: 'Simulate refund' }))
    await screen.findByText('Payment status: refunded')
    expect(screen.getByText('Refunded: $25.00')).toBeTruthy()
  })
  it('explains unconfigured Stripe without displaying simulated success or checkout actions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...pending, provider: 'stripe', configured: false, simulated: false })))
    render(<PaymentPanel token="submission.expiry.signature" />)
    await screen.findByText('Payment provider: not configured.')
    expect(screen.queryByRole('button', { name: /Simulate/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Continue to Stripe/ })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Payment' })))
  })
  it('offers calculated totals outside repeaters and respects the parent permission boundary', () => {
    const value = emptyDefinition(), onChange = vi.fn()
    value.fields = [{ id: 'total', kind: 'calculated', label: 'Total' }, { id: 'items', kind: 'repeater', label: 'Items', children: [{ id: 'each', kind: 'calculated', label: 'Each' }] }]
    value.payment = { provider: 'stripe', amountField: 'total', currency: 'USD' }
    render(<fieldset disabled><PaymentSettings definition={value} onChange={onChange} availability={{ stripe: false, simulator: false }} /></fieldset>)
    expect(screen.getByRole('option', { name: 'Total' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Each' })).toBeNull()
    expect(screen.queryByRole('option', { name: /Local simulator/ })).toBeNull()
    expect(screen.getByLabelText('Collect payment').matches(':disabled')).toBe(true)
  })
})
