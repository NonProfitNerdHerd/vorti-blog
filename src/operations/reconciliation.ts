import { verifyStripeEvent } from '../forms/payments'
import { hashToken } from '../forms/security'
import type { OperationsEnvironment } from './maintenance'

/** Authenticate retired callbacks and retain reconciliation evidence without
 * creating submissions, outbound messages or payments in the new installation. */
export async function reconcileRetiredCallback(request: Request, env: OperationsEnvironment & { STRIPE_TEST_WEBHOOK_SECRET?: string }): Promise<Response | null> {
  if (!env.OPERATIONS || new URL(request.url).pathname !== '/api/forms-payment-webhook' || request.method !== 'POST') return null
  if (!env.STRIPE_TEST_WEBHOOK_SECRET) return null
  const reader=request.clone().body?.getReader()
  if(!reader)return null
  const chunks:Uint8Array[]=[];let size=0
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>256000){await Promise.all([reader.cancel(),request.body?.cancel()]);return new Response('Event too large',{status:413})}chunks.push(part.value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  const raw=new TextDecoder().decode(bytes)
  let event
  try{event=await verifyStripeEvent(raw,request.headers.get('stripe-signature')||'',env.STRIPE_TEST_WEBHOOK_SECRET)}catch{return new Response('Invalid event',{status:400,headers:{'Cache-Control':'no-store'}})}
  if(!event)return null
  for(const reference of [event.reference,event.intent].filter((value):value is string=>!!value)) {
    const referenceHash=await hashToken(reference)
    if(!await env.OPERATIONS.prepare("SELECT 1 FROM release_external_effects WHERE provider='stripe-test' AND reference_hash=?").bind(referenceHash).first())continue
    await env.OPERATIONS.prepare("INSERT OR IGNORE INTO release_external_events(provider,event_hash,reference_hash,body_hash,received_at) VALUES('stripe-test',?,?,?,?)").bind(await hashToken(event.id),referenceHash,await hashToken(raw),new Date().toISOString()).run()
    return Response.json({received:true,reconciliationRequired:true},{status:202,headers:{'Cache-Control':'private, no-store'}})
  }
  return null
}
