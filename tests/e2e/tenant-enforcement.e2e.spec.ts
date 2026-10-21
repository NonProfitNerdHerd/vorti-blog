import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const fixturePath = process.env.TENANT_HTTP_FIXTURE
test.describe('tenant enforcement through authenticated native HTTP APIs', () => {
  test.skip(
    !fixturePath,
    'Run the isolated native tenant helper and supply its fictional fixture file.',
  )
  test('keeps REST lists, counts, IDs, and GraphQL inside the selected authorized site', async ({
    playwright,
    baseURL,
  }) => {
    const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8'))
    const tokens: string[] = []
    for (const account of [fixture.userA, fixture.userB]) {
      const client = await playwright.request.newContext({ baseURL })
      const login = await client.post('/api/users/login', { data: account })
      expect(login.ok()).toBe(true)
      tokens.push((await login.json()).token)
      await client.dispose()
    }
    const a = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `JWT ${tokens[0]}`, 'x-vorticause-site': fixture.a },
    })
    const b = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `JWT ${tokens[1]}`, 'x-vorticause-site': fixture.b },
    })
    try {
      const posts = await a.get('/api/posts?depth=0&limit=100&draft=true')
      expect(posts.ok()).toBe(true)
      expect((await posts.json()).docs.map((doc: { id: number }) => doc.id)).toEqual([
        fixture.postA,
      ])
      expect([403, 404]).toContain((await a.get(`/api/posts/${fixture.postB}?draft=true`)).status())
      expect([403, 404]).toContain(
        (await b.get(`/api/task-projects/${fixture.projectA}?depth=0`)).status(),
      )
      expect([403, 404]).toContain(
        (await b.get(`/api/task-boards/${fixture.boardA}?depth=0`)).status(),
      )
      const foreignTasks = await a.get(`/api/review-tasks/count?where[id][equals]=${fixture.taskB}`)
      expect(foreignTasks.ok()).toBe(true)
      expect((await foreignTasks.json()).totalDocs).toBe(0)
      const docTasks = await b.get(
        `/api/review-tasks/count?where[id][equals]=${fixture.documentTask}`,
      )
      expect((await docTasks.json()).totalDocs).toBe(0)
      const forms = await b.get('/api/forms?draft=true&depth=0')
      expect(forms.ok()).toBe(true)
      expect((await forms.json()).docs.map((doc: { id: number }) => doc.id)).toEqual([
        fixture.formB,
      ])
      expect([403, 404]).toContain((await b.get(`/api/forms/${fixture.formA}?draft=true`)).status())
      const gql = await a.post('/api/graphql', {
        data: {
          query:
            'query { Posts(limit: 100, draft: true) { docs { id title platformSite } totalDocs } }',
        },
      })
      const graph = await gql.json()
      expect(graph.errors).toBeUndefined()
      expect(graph.data.Posts.totalDocs).toBe(1)
      expect(
        graph.data.Posts.docs.every(
          (doc: { platformSite: string }) => doc.platformSite === fixture.a,
        ),
      ).toBe(true)
      const forbiddenSite = await a.get('/api/posts', {
        headers: { 'x-vorticause-site': fixture.b },
      })
      expect([403, 404]).toContain(forbiddenSite.status())
      const anonymous = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { 'x-vorticause-site': fixture.a },
      })
      const publicPosts = await anonymous.get('/api/posts?depth=0&limit=100')
      expect(
        (await publicPosts.json()).docs.some((doc: { id: number }) =>
          [fixture.postA, fixture.postB].includes(doc.id),
        ),
      ).toBe(false)
      await anonymous.dispose()
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })
})
