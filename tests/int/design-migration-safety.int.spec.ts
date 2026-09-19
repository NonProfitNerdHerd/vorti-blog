import { afterEach, describe, expect, it, vi } from 'vitest'
import { up } from '@/migrations/20260917_165910_design_system_stage2'

describe('Stage 2 administrator backfill guard', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('rejects an existing Users table without an explicit administrator', async () => {
    vi.stubEnv('DESIGN_ADMIN_EMAIL', '')
    const db = { all: vi.fn().mockResolvedValue([{ id: 1 }]), run: vi.fn() }
    await expect(up({ db } as never)).rejects.toThrow('requires DESIGN_ADMIN_EMAIL')
    expect(db.run).not.toHaveBeenCalled()
  })

  it('rejects an unmatched administrator before schema changes', async () => {
    vi.stubEnv('DESIGN_ADMIN_EMAIL', 'missing@example.test')
    const db = { all: vi.fn().mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]), run: vi.fn() }
    await expect(up({ db } as never)).rejects.toThrow('match exactly one existing User')
    expect(db.run).not.toHaveBeenCalled()
  })
})
