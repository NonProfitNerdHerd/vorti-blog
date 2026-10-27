import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { permissions } from '../../src/organizations/permission-catalog'

/** Browser fixtures exercise invitations once tenant authority is installed.
 * Legacy releases retain their existing account-creation fixture. */
export async function createBrowserUser(request: APIRequestContext, options: {data: Record<string, unknown>}) {
  const probe = await request.get('/api/tenant-settings?site=default&section=roles')
  if (probe.status() === 404 || probe.status() === 503) return request.post('/api/users', options)
  expect(probe.ok(), await probe.text()).toBe(true)
  const origin = new URL(probe.url()).origin, headers = {Origin: origin}
  const settings = async () => (await request.get('/api/tenant-settings?site=default&section=roles')).json()
  const mutate = async (data: object) => {
    const state = await settings()
    const response = await request.post('/api/tenant-settings', {headers, data: {site: 'default', expectedRevision: state.revision, operationKey: crypto.randomUUID(), ...data}})
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const invitation = await mutate({action: 'invite', email: options.data.email})
  const anonymous = await playwrightRequest.newContext({baseURL: origin})
  let doc: {id: number; email: string; username: string}
  try {
    const accepted = await anonymous.post('/api/tenant-invitations/accept', {headers, data: {token: invitation.token, username: options.data.username, password: options.data.password}})
    expect(accepted.ok(), await accepted.text()).toBe(true)
    const login = await anonymous.post('/api/users/login', {data: {email: options.data.email, password: options.data.password}})
    expect(login.ok(), await login.text()).toBe(true)
    doc = (await login.json()).user
  } finally { await anonymous.dispose() }
  const role = `fixture-${doc.id}`
  await mutate({action: 'role-save', id: role, name: `Fixture member ${doc.id}`, description: 'Synthetic browser-test role', permissions: permissions.filter(permission => /^(tasks|pages|posts|crm):/.test(permission))})
  await mutate({action: 'role-assign', id: crypto.randomUUID(), user: doc.id, role, assignmentSite: 'default', descendants: false})
  return {ok: () => true, status: () => 200, text: async () => JSON.stringify({doc}), json: async () => ({doc})}
}
