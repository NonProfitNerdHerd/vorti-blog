'use client'
import { flattenFields, type FormDefinition, type FormField } from './model'
import { paymentCurrencies } from './payment'

export interface PaymentAvailability { stripe: boolean; simulator: boolean }
export function PaymentSettings({ definition, onChange, availability }: { definition: FormDefinition; onChange: (value: FormDefinition) => void; availability?: PaymentAvailability }) {
  const blocked = new Set<string>()
  const visit = (fields: FormField[], repeated = false) => fields.forEach(field => { if (repeated) blocked.add(field.id); visit(field.children || [], repeated || field.kind === 'repeater') })
  visit(definition.fields)
  const amounts = flattenFields(definition.fields).filter(field => field.kind === 'calculated' && !blocked.has(field.id)), payment = definition.payment
  return <section className="forms-rule-card"><h3>Payment</h3>
    <p>Collect a one-time test payment using a calculated total. Card details stay on Stripe’s hosted checkout. Responses are saved before checkout.</p>
    <label className="forms-builder-check"><input type="checkbox" checked={!!payment} onChange={event => onChange({ ...definition, payment: event.target.checked ? { provider: 'stripe', amountField: amounts[0]?.id || '', currency: 'USD' } : undefined })} />Collect payment</label>
    {payment && <>
      <label>Payment provider<select value={payment.provider} onChange={event => onChange({ ...definition, payment: { ...payment, provider: event.target.value as 'stripe' | 'simulator' } })}><option value="stripe">Stripe test mode</option>{(availability?.simulator || payment.provider === 'simulator') && <option value="simulator">Local simulator (no transaction)</option>}</select></label>
      <p role="status">{availability === undefined ? 'Provider configuration could not be checked.' : availability[payment.provider] ? payment.provider === 'simulator' ? 'Development simulator available. No money is charged.' : 'Stripe test credentials and webhook are configured.' : 'Not configured. Responses can be saved; payment-dependent actions will wait.'}</p>
      <label>Calculated total<select value={payment.amountField} onChange={event => onChange({ ...definition, payment: { ...payment, amountField: event.target.value } })}><option value="">Choose a calculated field</option>{amounts.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
      {!amounts.length && <p>Add a calculated field in Build to determine the payment total.</p>}
      <label>Currency<select value={payment.currency} onChange={event => onChange({ ...definition, payment: { ...payment, currency: event.target.value } })}>{Object.keys(paymentCurrencies).map(currency => <option key={currency}>{currency}</option>)}</select></label>
      <p>The total is recomputed on the server. Choose “Wait for verified payment success” on each action that needs payment.</p>
    </>}
  </section>
}
