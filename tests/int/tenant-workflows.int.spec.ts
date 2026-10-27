import { expect,it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { prepareInstallation } from '../../scripts/lib/prepare-installation'
import { AutomationStore, type AutomationRow } from '../../src/automations/store'

it('audits tenant administrator workflow visibility and transfers ownership only into a paused unpublished state',async()=>{
  const f=localD1()
  try {
    await prepareInstallation(f.db,{mode:'install',administratorEmail:'admin@example.com',password:'synthetic-password-only'})
    f.sqlite.exec("INSERT INTO users(id,email,role) VALUES(2,'owner@example.com','editor'),(3,'recipient@example.com','editor'); INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',2,1),('default',3,1); INSERT INTO vc_tenant_roles(id,tenant_id,name) VALUES('workflow-author','default','Workflow author'); INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('owner','default',2,'workflow-author','default',0),('recipient','default',3,'workflow-author','default',0)")
    for(const action of ['read','create','edit','publish','execute','diagnostics'])f.sqlite.prepare('INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES(?,?)').run('workflow-author',`workflows:${action}`)
    const store=new AutomationStore(f.db)
    const draft=await store.save('default',2,{name:'Private owner workflow',definition:{trigger:{kind:'manual'},steps:[{id:'condition',name:'Check',kind:'condition',left:1,right:1,operator:'equals'}]}})
    const published=await store.control(draft,'publish')
    await store.share(published,true)
    const current=await store.get('default',2,draft.id)
    const run=await store.enqueue(current,'live',{id:'test-event',input:{}})
    expect((await store.view('default',1,{id:current.id}) as AutomationRow).owner).toBe(2)
    expect(await store.view('default',3,{})).toEqual([])
    await expect(store.view('default',3,{id:current.id})).rejects.toThrow('unavailable')
    expect(f.sqlite.prepare("SELECT count(*) n FROM vc_platform_audit WHERE action='tenant-administrator.read'").get()?.n).toBeGreaterThan(0)
    await store.transfer(current,'recipient@example.com')
    expect(await store.get('default',3,current.id)).toMatchObject({active:0,published:null,shared:0,owner:3})
    expect(await store.run('default',2,run)).toMatchObject({status:'canceled',cancel_requested:1})
    await expect(store.transfer(current,'owner@example.com')).rejects.toThrow()
  }finally{f.close()}
})
