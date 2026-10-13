import { afterEach, describe, expect, it, vi } from 'vitest'
import { stripeTestProvider, verifyStripeEvent } from '@/forms/payments'
import { hmac } from '@/forms/security'

afterEach(() => vi.unstubAllGlobals())
describe('Stripe test payment boundary', () => {
  it('verifies raw signatures, test mode, freshness, and typed payment references', async () => {
    const now = 1800000000000, timestamp = String(now / 1000), secret = 'whsec_test'
    const payload = { id: 'evt_one', type: 'payment_intent.succeeded', livemode: false, created: now / 1000, data: { object: { id: 'pi_one', metadata: { submissionKey: 'submission' } } } }
    const signed = async (value: unknown) => { const raw = JSON.stringify(value); return { raw, signature: `t=${timestamp},v1=${await hmac(secret, `${timestamp}.${raw}`)}` } }
    const valid = await signed(payload)
    await expect(verifyStripeEvent(valid.raw, valid.signature, secret, now)).resolves.toMatchObject({ id: 'evt_one', status: 'paid', intent: 'pi_one' })
    await expect(verifyStripeEvent(valid.raw + ' ', valid.signature, secret, now)).rejects.toThrow('signature')
    await expect(verifyStripeEvent(valid.raw, valid.signature, secret, now + 301000)).rejects.toThrow('timestamp')
    const live = await signed({ ...payload, livemode: true })
    await expect(verifyStripeEvent(live.raw, live.signature, secret, now)).rejects.toThrow('test-mode')
    const forged = await signed({ ...payload, type: 'charge.refunded', data: { object: { id: 'ch_one' } } })
    await expect(verifyStripeEvent(forged.raw, forged.signature, secret, now)).rejects.toThrow('reference')
  })
  it('creates idempotent hosted card checkout using server-supplied minor units and refuses live credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'cs_test_one', url: 'https://checkout.stripe.com/c/pay/test', livemode: false }))
    vi.stubGlobal('fetch', fetcher)
    const input = { amount: 2500, currency: 'USD', submissionKey: 'key', title: 'Example', returnURL: 'https://example.com/forms/example#payment=private' }
    await expect(stripeTestProvider('sk_live_not_allowed').checkout(input)).rejects.toThrow('not configured')
    expect(fetcher).not.toHaveBeenCalled()
    await stripeTestProvider('sk_test_local').checkout(input)
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect(options.headers['Idempotency-Key']).toBe('forms:key')
    expect(options.redirect).toBe('error')
    expect(options.body.get('line_items[0][price_data][unit_amount]')).toBe('2500')
    expect(options.body.get('payment_method_types[0]')).toBe('card')
    expect(options.body.get('payment_intent_data[metadata][submissionKey]')).toBe('key')
  })
  it('reads the stored checkout with expanded payment state and rejects incomplete expansion', async () => {
    const value = { id: 'cs_test_one', livemode: false, amount_total: 2500, currency: 'usd', metadata: { submissionKey: 'key' }, payment_status: 'paid', payment_intent: { id: 'pi_one', status: 'succeeded', latest_charge: { amount: 2500, amount_refunded: 2500, refunded: true } } }
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(value)).mockResolvedValueOnce(Response.json({ ...value, payment_intent: { ...value.payment_intent, latest_charge: 'ch_unexpanded' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(stripeTestProvider('sk_test_local').read('cs_test_one')).resolves.toMatchObject({ status: 'refunded', refundedAmount: 2500, amount: 2500, intent: 'pi_one', submissionKey: 'key' })
    expect(fetcher.mock.calls[0][0]).toContain('cs_test_one?expand[]=payment_intent.latest_charge')
    await expect(stripeTestProvider('sk_test_local').read('cs_test_one')).rejects.toThrow('Unexpected')
  })
})
