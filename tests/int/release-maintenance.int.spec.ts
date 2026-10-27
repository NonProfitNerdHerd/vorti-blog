import { expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import {
  releaseOperationsSchema,
  acquireRelease,
  advanceRelease,
} from '../../scripts/lib/release-lock'
import { maintenanceRequired, operationalProbe } from '../../src/operations/maintenance'

it('keeps requests and jobs stopped through cutover and recovery without an expiring lease', async () => {
  const fixture = localD1()
  try {
    for (const sql of releaseOperationsSchema) fixture.sqlite.exec(sql)
    const env = { OPERATIONS: fixture.db, RELEASE_TARGET: 'test-installation' }
    expect(await maintenanceRequired({})).toBe(false)
    expect(await maintenanceRequired({ RELEASE_TARGET: env.RELEASE_TARGET })).toBe(true)
    let lease = await acquireRelease(fixture.db, {
      id: crypto.randomUUID(),
      target: env.RELEASE_TARGET,
      mode: 'development-reset',
      baseline: {},
    })
    expect(await maintenanceRequired(env)).toBe(false)
    lease = await advanceRelease(fixture.db, lease, 'prepared', { validationPassed: true })
    lease = await advanceRelease(fixture.db, lease, 'frozen', {})
    expect(await maintenanceRequired(env)).toBe(true)
    lease = await advanceRelease(fixture.db, lease, 'recovering', {})
    expect(await maintenanceRequired(env)).toBe(true)
    await expect(advanceRelease(fixture.db, lease, 'aborted', {})).rejects.toThrow('Recovery')
    await advanceRelease(fixture.db, lease, 'aborted', { recoveryVerified: true })
    expect(await maintenanceRequired(env)).toBe(false)
  } finally {
    fixture.close()
  }
})

it('requires a configured high-entropy operator secret for maintenance probes', () => {
  const token = 'test-only-operator-token-with-more-than-32-characters'
  const request = (value: string) =>
    new Request('https://example.com/admin', { headers: { 'x-vorti-release-probe': value } })
  expect(operationalProbe(request(token), {})).toBe(false)
  expect(operationalProbe(request('wrong'), { RELEASE_OPERATOR_TOKEN: token })).toBe(false)
  expect(operationalProbe(request(token), { RELEASE_OPERATOR_TOKEN: token })).toBe(true)
})

it('permits only the real login check during verification, never ordinary writes or jobs', async () => {
  const fixture = localD1()
  try {
    for (const sql of releaseOperationsSchema) fixture.sqlite.exec(sql)
    const env = {OPERATIONS:fixture.db,RELEASE_TARGET:'test-installation'}
    const login = new Request('https://example.com/api/users/login',{method:'POST'})
    let lease = await acquireRelease(fixture.db,{id:crypto.randomUUID(),target:env.RELEASE_TARGET,mode:'development-reset',baseline:{}})
    lease = await advanceRelease(fixture.db,lease,'prepared',{validationPassed:true})
    lease = await advanceRelease(fixture.db,lease,'frozen',{})
    expect(await maintenanceRequired(env,login)).toBe(true)
    lease = await advanceRelease(fixture.db,lease,'cutover',{writesStopped:true,recoveryVerified:true,queuesStopped:true,queuesPurged:true})
    expect(await maintenanceRequired(env,login)).toBe(true)
    lease = await advanceRelease(fixture.db,lease,'verifying',{})
    expect(await maintenanceRequired(env,login)).toBe(false)
    for (const path of ['/admin/login','/api/users/me']) expect(await maintenanceRequired(env,new Request(`https://example.com${path}`))).toBe(false)
    expect(await maintenanceRequired(env)).toBe(true)
    for (const path of ['/api/users','/api/users/reset-password','/api/review-tasks','/api/tenant-settings']) expect(await maintenanceRequired(env,new Request(`https://example.com${path}`,{method:'POST'}))).toBe(true)
    expect(await maintenanceRequired(env,new Request('https://example.com/admin'))).toBe(true)
    await advanceRelease(fixture.db,lease,'recovering',{})
    expect(await maintenanceRequired(env,login)).toBe(true)
  } finally { fixture.close() }
})
