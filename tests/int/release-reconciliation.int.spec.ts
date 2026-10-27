import { expect,it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { releaseOperationsSchema } from '../../scripts/lib/release-lock'
import { captureExternalEffects } from '../../scripts/lib/capture-external-effects'
import { reconcileRetiredCallback } from '../../src/operations/reconciliation'
import { hashToken,hmac } from '../../src/forms/security'

it('authenticates and deduplicates retired callbacks without retaining payloads or replaying effects',async()=>{
  const source=localD1(),operations=localD1()
  try {
    source.sqlite.exec("CREATE TABLE form_payment_sessions(checkout_ref TEXT,intent_ref TEXT); INSERT INTO form_payment_sessions VALUES('cs_test_old123','pi_old123')")
    for(const statement of releaseOperationsSchema)operations.sqlite.exec(statement)
    expect(await captureExternalEffects(source.db,operations.db,crypto.randomUUID())).toEqual({capturedReferences:2,automaticReplay:false})
    expect(JSON.stringify(operations.sqlite.prepare('SELECT * FROM release_external_effects').all())).not.toContain('cs_test_old123')
    const secret='whsec_synthetic_only',timestamp=String(Math.floor(Date.now()/1000))
    const raw=JSON.stringify({id:'evt_retired',type:'checkout.session.completed',livemode:false,created:Number(timestamp),data:{object:{id:'cs_test_old123',payment_status:'paid',payment_intent:'pi_old123',metadata:{submissionKey:'private-answer-key'}}}})
    const signature=await hmac(secret,`${timestamp}.${raw}`)
    const request=(value:string)=>new Request('https://example.com/api/forms-payment-webhook',{method:'POST',body:raw,headers:{'stripe-signature':value}})
    const env={OPERATIONS:operations.db,STRIPE_TEST_WEBHOOK_SECRET:secret}
    expect((await reconcileRetiredCallback(request(`t=${timestamp},v1=invalid`),env))?.status).toBe(400)
    expect(operations.sqlite.prepare('SELECT count(*) n FROM release_external_events').get()?.n).toBe(0)
    for(let i=0;i<2;i++)expect((await reconcileRetiredCallback(request(`t=${timestamp},v1=${signature}`),env))?.status).toBe(202)
    const events=operations.sqlite.prepare('SELECT * FROM release_external_events').all()
    expect(events).toHaveLength(1)
    expect(events[0].body_hash).toBe(await hashToken(raw))
    expect(JSON.stringify(events)).not.toContain('private-answer-key')
    expect(operations.sqlite.prepare("SELECT count(*) n FROM release_external_effects WHERE state='blocked'").get()?.n).toBe(2)
  }finally{source.close();operations.close()}
})
