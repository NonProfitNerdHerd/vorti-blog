import { describe, expect, it, vi } from 'vitest'
import { validateEntryReview, auditEntryReview } from '@/forms/entry-workflow'
import type { FormPlatform } from '@/forms/platform'

function scenario(role = 'editor', workflow?: unknown) {
  const create = vi.fn().mockResolvedValue({})
  const find = vi.fn().mockResolvedValue({ docs: [{ definition: { workflow } }] })
  const findByID = vi.fn().mockResolvedValue({ id: 4, role: 'editor' })
  const req = { user: { id: 3, role }, context: {}, payload: { create, find, findByID } }
  const originalDoc = { id: 2, site: 'default', form: 1, revision: 'immutable-one', workflowStatus: 'received', idempotencyKey: 'accepted-key' }
  const validate = (data: Record<string, unknown>, original = originalDoc) => validateEntryReview({ data, originalDoc: original, operation: 'update', req } as never)
  return { req, originalDoc, create, find, findByID, validate }
}

describe('entry workflow enforcement', () => {
  it('uses the entry’s immutable revision and permits only configured role transitions', async () => {
    const s = scenario('editor', { transitions: [{ from: 'received', to: 'approved', roles: ['administrator'] }] })
    await expect(s.validate({ workflowStatus: 'approved' })).rejects.toMatchObject({ status: 400 })
    expect(s.find.mock.calls[0][0].where.and).toEqual([{ revision: { equals: 'immutable-one' } }, { site: { equals: 'default' } }, { form: { equals: 1 } }])
    await expect(scenario('administrator', { transitions: [{ from: 'received', to: 'approved', roles: ['administrator'] }] }).validate({ workflowStatus: 'approved' })).resolves.toEqual({ workflowStatus: 'approved' })
  })
  it('fails closed for missing revisions and does not let non-reviewers use the Local API', async () => {
    const s = scenario(); s.find.mockResolvedValue({ docs: [] })
    await expect(s.validate({ workflowStatus: 'approved' })).rejects.toMatchObject({ status: 400 })
    await expect(scenario('designer').validate({ notes: 'forged' })).rejects.toMatchObject({ status: 403 })
    await expect(s.validate({ notes: 'cross-site' }, { ...s.originalDoc, site: 'another-site' })).rejects.toMatchObject({ status: 403 })
  })
  it('checks reviewer entry access rather than merely accepting a user ID', async () => {
    const s = scenario(); s.findByID.mockResolvedValue({ id: 4, role: 'designer' })
    await expect(s.validate({ reviewer: 4 })).rejects.toMatchObject({ status: 400 })
    s.findByID.mockResolvedValue({ id: 4, role: 'editor' })
    await expect(s.validate({ reviewer: 4 })).resolves.toEqual({ reviewer: 4 })
  })
  it('records review changes and releases confirmed reservations when rejected', async () => {
    const s = scenario(); const run = vi.fn().mockResolvedValue({}); const bind = vi.fn(() => ({ run })); const prepare = vi.fn(() => ({ bind }))
    const hook = auditEntryReview({ db: { prepare } } as unknown as FormPlatform)
    const doc = { ...s.originalDoc, workflowStatus: 'rejected', notes: 'No places needed' }
    await hook({ doc, previousDoc: s.originalDoc, req: s.req, operation: 'update' } as never)
    expect(bind).toHaveBeenCalledWith('default', 'accepted-key')
    expect(s.create.mock.calls[0][0].data).toMatchObject({ actorID: '3', submissionID: '2', site: 'default', changes: { workflowStatus: { before: 'received', after: 'rejected' } } })
    prepare.mockClear(); s.create.mockClear()
    await hook({ doc: { ...doc, workflowStatus: 'in-review' }, previousDoc: doc, req: s.req, operation: 'update' } as never)
    expect(prepare).not.toHaveBeenCalled()
    expect(s.create).toHaveBeenCalledTimes(1)
  })
})
