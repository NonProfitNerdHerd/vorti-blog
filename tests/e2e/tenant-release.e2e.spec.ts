import { expect,test } from '@playwright/test'

test.beforeEach(async({page})=>{
  expect((await page.request.post('/api/users/login',{data:{email:'dev@payloadcms.com',password:'test'}})).ok()).toBe(true)
})

test('scoped Settings saves, exposes tenant controls, and keeps built-in permissions read-only',async({page})=>{
  await page.goto('/admin/globals/system-settings?site=default&section=general')
  await expect(page.getByRole('navigation',{name:'Settings sections'})).toBeVisible()
  await page.getByLabel('Site name',{exact:true}).fill('Tenant acceptance')
  await page.getByRole('button',{name:'Save changes',exact:true}).click()
  await expect(page.getByText('Settings saved.',{exact:true})).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Site name',{exact:true})).toHaveValue('Tenant acceptance')
  await expect(page.getByLabel('Workspace embed origins (one HTTPS origin per line)')).toBeVisible()
  await page.getByRole('link',{name:'Roles',exact:true}).click()
  await page.getByRole('button',{name:'Tenant Administrator',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'tasks:read',exact:true})).toBeDisabled()
  await expect(page.getByText('Memberships and assignments',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Create role',exact:true}).click()
  const name=`Browser task reader ${Date.now()}`
  await page.getByLabel('Role name',{exact:true}).fill(name)
  await page.getByRole('checkbox',{name:'tasks:read',exact:true}).check()
  await page.getByRole('button',{name:'Save role',exact:true}).click()
  await expect(page.getByRole('button',{name,exact:true})).toBeVisible()
})

test('Wiki private ancestry, rich text, protected attachments and feature gates work through real routes',async({page,browser,baseURL})=>{
  const headers={Origin:baseURL!},suffix=Date.now(),id=`wiki-${suffix}`
  const body={root:{type:'root',version:1,children:[{type:'paragraph',version:1,children:[{type:'text',version:1,text:'Protected browser knowledge',format:0,style:'',mode:'normal',detail:0}],direction:null as null,format:'',indent:0}],direction:null as null,format:'',indent:0}}
  const draft={site:'default',kind:'wiki',id,parent:null as string | null,title:`Private Wiki ${suffix}`,slug:`private-${suffix}`,body,visibility:'private',action:'save',expectedRevision:0}
  const save=async(data:object)=>{
    const response=await page.request.post('/api/knowledge?site=default&kind=wiki',{headers,data:{...data,operationKey:crypto.randomUUID()}})
    expect(response.ok(),await response.text()).toBe(true)
  }
  await save(draft)
  await save({...draft,action:'publish',expectedRevision:1})
  await page.goto(`/wiki/${id}/${draft.slug}?manage=1`)
  await expect(page.getByLabel('Title',{exact:true})).toHaveValue(draft.title)
  await expect(page.getByRole('textbox',{name:'Page content'})).toContainText('Protected browser knowledge')
  const upload=await page.request.post(`/api/knowledge/attachments?site=default&kind=wiki&id=${id}`,{headers,multipart:{file:{name:'protected.txt',mimeType:'text/plain',buffer:Buffer.from('private attachment')}}})
  expect(upload.ok(),await upload.text()).toBe(true)
  const file=await upload.json() as {id:string}
  const download=`/api/knowledge?site=default&kind=wiki&id=${id}&file=${file.id}`
  expect((await page.request.get(download)).status()).toBe(200)
  const anonymous=await browser.newContext({baseURL})
  try {
    expect((await anonymous.request.get(download)).status()).toBe(404)
    const listing=await anonymous.request.get('/api/knowledge?site=default&kind=wiki&search=Protected')
    expect(await listing.text()).not.toContain(id)
    const child={...draft,id:`${id}-child`,parent:id,title:'Public child of private parent',slug:`child-${suffix}`,visibility:'public'}
    await save(child);await save({...child,action:'publish',expectedRevision:1})
    expect((await anonymous.request.get(`/api/knowledge?site=default&kind=wiki&id=${child.id}`)).status()).toBe(404)
    const feature=async(value:boolean)=>{
      const current=await (await page.request.get('/api/tenant-settings?site=default&section=features')).json() as {revision:number}
      const response=await page.request.post('/api/tenant-settings',{headers,data:{site:'default',action:'feature',feature:'wiki',featureSite:null,value,expectedRevision:current.revision,operationKey:crypto.randomUUID()}})
      expect(response.ok(),await response.text()).toBe(true)
    }
    await feature(false)
    try {
      expect((await page.request.get(download)).status()).toBe(403)
      expect((await anonymous.request.get(download)).status()).toBe(404)
    }finally{await feature(true)}
    expect((await page.request.get(download)).status()).toBe(200)
  }finally{await anonymous.close()}
})
