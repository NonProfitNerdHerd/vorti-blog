import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import {
  acquireRelease,
  advanceRelease,
  releaseOperationsSchema,
} from '../../scripts/lib/release-lock'

describe('concurrent release coordination on D1', () => {
  let proxy: PlatformProxy<{ D1: D1Database }>
  beforeAll(async () => {
    proxy = await getPlatformProxy<{ D1: D1Database }>({
      configPath: 'tests/fixtures/organization-worker/wrangler.jsonc',
      persist: false,
      remoteBindings: false,
    })
    for (const statement of releaseOperationsSchema) await proxy.env.D1.prepare(statement).run()
  })
  afterAll(async () => {
    await proxy?.dispose()
  })
  it('allows exactly one competing release and exactly one transition from a revision', async () => {
    const db = proxy.env.D1
    const contenders = await Promise.allSettled(
      [1, 2].map(() =>
        acquireRelease(db, {
          id: crypto.randomUUID(),
          target: 'concurrent-release',
          mode: 'upgrade',
          baseline: { version: 'old' },
        }),
      ),
    )
    const winners = contenders.filter((result) => result.status === 'fulfilled')
    expect(winners).toHaveLength(1)
    expect(contenders.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const lease = winners[0].value
    const transitions = await Promise.allSettled([
      advanceRelease(db, lease, 'prepared', { validationPassed: true }),
      advanceRelease(db, lease, 'aborted', {}),
    ])
    expect(transitions.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(transitions.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(
      (
        await db
          .prepare('SELECT count(*) AS n FROM release_events WHERE run_id=?')
          .bind(lease.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(2)
    expect(
      (await db.prepare('SELECT count(*) AS n FROM release_write_guards').first<{ n: number }>())
        ?.n,
    ).toBe(0)
  })
})
