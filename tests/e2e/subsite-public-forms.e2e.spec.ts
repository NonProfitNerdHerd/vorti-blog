import { expect, test } from '@playwright/test'
import { emptyDefinition } from '@design-system/payload-design-core/forms'

test('child public Forms keep their site context and reject submissions while ancestor-paused', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(300000)
  const origin = new URL(baseURL!).origin
  expect(['localhost', '127.0.0.1'].includes(new URL(origin).hostname)).toBe(true)
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(login.ok()).toBe(true)
  const status = async (site: string) => {
    const response = await page.request.get('/api/organization-admin?site=' + site + '&website=1')
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const toggle = async (enabled: boolean) => {
    const current = await status('default')
    const response = await page.request.post('/api/organization-admin', {
      headers: { Origin: origin },
      data: {
        action: 'subsites',
        site: 'default',
        enabled,
        expectedRevision: current.revision,
        confirmedDescendants: current.descendants,
        operationKey: crypto.randomUUID(),
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const before = await status('default')
  const originalContext = (await (await page.request.get('/api/organization-admin')).json()).context
  const selectEditorSite = async (site: string) => {
    const current = (await (await page.request.get('/api/organization-admin')).json()).context
    const response = await page.request.post('/api/organization-admin', {
      headers: { Origin: origin },
      data: {
        action: 'context',
        site,
        expectedRevision: current.revision,
        operationKey: crypto.randomUUID(),
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const visitorContext = await context.browser()!.newContext({ baseURL: origin })
  try {
    if (!before.subsites_enabled) await toggle(true)
    const parent = await (await page.request.get('/api/organization-admin?site=default')).json()
    const key = 'forms-child-' + Date.now().toString(36)
    const created = await page.request.post('/api/organization-admin', {
      headers: { Origin: origin },
      data: {
        action: 'create-site',
        site: 'default',
        name: 'Fictional Forms child',
        routeKey: key,
        expectedRevision: parent.site.revision,
        operationKey: crypto.randomUUID(),
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const result = await created.json()
    expect(result.initializationError).toBeUndefined()
    const site = result.doc.site as string
    const website = await status(site)
    const published = await page.request.post('/api/organization-admin', {
      headers: { Origin: origin },
      data: {
        action: 'publication',
        site,
        enabled: true,
        expectedRevision: website.revision,
        operationKey: crypto.randomUUID(),
      },
    })
    expect(published.ok(), await published.text()).toBe(true)
    const definition = emptyDefinition()
    definition.fields = [
      { id: 'answer', kind: 'text', label: 'Fictional child answer', required: true },
    ]
    const slug = 'isolated-' + key
    const primaryDefinition = structuredClone(definition)
    primaryDefinition.fields[0].label = 'Fictional primary answer'
    const primaryForm = await page.request.post('/api/forms', {
      headers: { 'x-vorticause-site': 'default' },
      data: {
        title: 'Fictional primary public form',
        site: 'default',
        editorSite: 'default',
        slug,
        definition: primaryDefinition,
        _status: 'published',
      },
    })
    expect(primaryForm.ok(), await primaryForm.text()).toBe(true)
    const form = await page.request.post('/api/forms', {
      headers: { 'x-vorticause-site': site },
      data: {
        title: 'Fictional child public form',
        site,
        editorSite: site,
        slug,
        definition,
        _status: 'published',
      },
    })
    expect(form.ok(), await form.text()).toBe(true)
    await selectEditorSite(site)
    const primary = await page.request.get('/api/forms-runtime/' + slug)
    expect(primary.ok(), await primary.text()).toBe(true)
    expect((await primary.json()).definition.fields[0].label).toBe('Fictional primary answer')
    const forged = await page.request.get('/api/forms-runtime/' + slug, {
      headers: { 'x-vorticause-public-site': site },
    })
    expect((await forged.json()).definition.fields[0].label).toBe('Fictional primary answer')
    const visitor = await visitorContext.newPage()
    const runtimePath = '/sites/' + key + '/api/forms-runtime/' + slug
    const loaded = visitor.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === runtimePath && response.request().method() === 'GET',
    )
    const draftsLoaded = visitor.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/api/forms-runtime/' + slug + '/drafts'),
    )
    await visitor.goto('/sites/' + key + '/forms/' + slug)
    const runtimeResponse = await loaded
    expect(runtimeResponse.ok(), await runtimeResponse.text()).toBe(true)
    const runtime = await runtimeResponse.json()
    expect(new URL((await draftsLoaded).url()).pathname).toBe(runtimePath + '/drafts')
    expect(runtime.definition.fields[0].label).toBe('Fictional child answer')
    expect(
      (await (await visitor.request.get('/api/forms-runtime/' + slug)).json()).definition.fields[0]
        .label,
    ).toBe('Fictional primary answer')
    const submit = () =>
      visitor.request.post(runtimePath + '/submit', {
        headers: { Origin: origin, 'X-Form-Session': runtime.session },
        data: {
          revision: runtime.revision,
          idempotencyKey: crypto.randomUUID(),
          answers: { answer: 'Fictional local answer' },
        },
      })
    const accepted = await submit()
    expect(accepted.status(), await accepted.text()).toBe(201)
    await toggle(false)
    expect((await visitor.request.get('/')).status()).toBe(200)
    expect((await visitor.request.get('/api/forms-runtime/' + slug)).status()).toBe(200)
    expect((await visitor.request.get(runtimePath)).status()).toBe(404)
    expect((await submit()).status()).toBe(404)
    await toggle(true)
    expect((await visitor.request.get(runtimePath)).status()).toBe(200)
  } finally {
    await selectEditorSite(originalContext.site)
    if ((await status('default')).subsites_enabled !== before.subsites_enabled)
      await toggle(!!before.subsites_enabled)
    await visitorContext.close()
  }
})
