import { expect, test } from '@playwright/test'

test('primary website publication hides public content and retains authorized internal content', async ({page,browser,baseURL}) => {
  expect((await page.request.post('/api/users/login',{data:{email:'dev@payloadcms.com',password:'test'}})).ok()).toBe(true)
  const anonymous = await browser.newContext({baseURL})
  const headers = {Origin:baseURL!}
  const publish = async (enabled:boolean) => {
    const status = await (await page.request.get('/api/organization-admin?site=default&website=1')).json()
    const response = await page.request.post('/api/organization-admin',{headers,data:{action:'publication',site:'default',enabled,expectedRevision:status.revision,operationKey:crypto.randomUUID()}})
    expect(response.ok(),await response.text()).toBe(true)
  }
  try {
    await publish(true)
    await page.goto('/admin/globals/system-settings?site=default&section=reading')
    await expect(page.getByRole('button',{name:'Unpublish website',exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Unpublish website',exact:true}).click()
    await expect(page.getByRole('button',{name:'Publish website',exact:true})).toBeVisible()
    expect((await anonymous.request.get('/')).status()).toBe(404)
    expect((await anonymous.request.get('/api/knowledge?site=default&kind=wiki')).status()).toBe(404)
    expect((await page.request.get('/api/knowledge?site=default&kind=intranet')).status()).toBe(200)
    await page.goto('/intranet')
    await expect(page.getByRole('heading',{name:'Intranet',exact:true})).toBeVisible()
    await publish(true)
    expect((await anonymous.request.get('/api/knowledge?site=default&kind=wiki')).status()).toBe(200)
  } finally {
    await publish(true)
    await anonymous.close()
  }
})
