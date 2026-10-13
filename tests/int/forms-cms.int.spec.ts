import { describe, expect, it, vi } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'
import { emptyDefinition, type FormAction } from '@design-system/payload-design-core/forms'
import { authorizeCMSActions, cmsRecordData, registerCMSHandlers } from '@/forms/cms-actions'
import { ActionHandlers, type OutboxJob } from '@/forms/outbox'
import { FORM_INTERNAL } from '@/forms/access'
import type { FormPlatform } from '@/forms/platform'

vi.mock('payload', async importOriginal => ({ ...await importOriginal<typeof import('payload')>(), createLocalReq: async (options: object, payload: Payload) => ({ ...options, payload }) }))

const contact: FormAction = { id: 'contact', kind: 'contact', name: 'Contact', config: { emailField: 'email', nameField: 'name', approvedBy: '1' } }
const fields = [{ id: 'email', kind: 'email', label: 'Email' }, { id: 'name', kind: 'name', label: 'Name' }]
describe('permission-controlled CMS actions', () => {
  it('stamps the authenticated approver and refuses unauthorized publishing', async () => {
    const definition = { ...emptyDefinition(), fields, actions: [{ ...contact, config: { ...contact.config, approvedBy: '999' } }] }
    const req = { user: { id: 7, role: 'administrator' } } as PayloadRequest
    const approved = await authorizeCMSActions(definition, req, 'default')
    expect(approved.actions[0].config.approvedBy).toBe('7')
    expect(definition.actions[0].config.approvedBy).toBe('999')
    await expect(authorizeCMSActions(definition, { user: { id: 2, role: 'designer' } } as PayloadRequest, 'default')).rejects.toThrow('Integration permission')
    await expect(authorizeCMSActions(definition, req, 'other')).rejects.toThrow('Integration permission')
  })
  it('maps only allowlisted properties and stores submitted markup as text in a draft', () => {
    const action: FormAction = { id: 'post', kind: 'content', name: 'Post', config: { titleField: 'title', bodyField: 'body', postType: '3', role: 'administrator', _status: 'published', author: '999' } }
    const data = cmsRecordData(action, { title: 'A title', body: '<script>bad()</script>', role: 'administrator', _status: 'published' }, 7)
    expect(data).toMatchObject({ author: 7, postType: 3, _status: 'draft' })
    expect(data.role).toBeUndefined()
    expect(JSON.stringify(data.content)).toContain('"text":"<script>bad()</script>"')
    expect(cmsRecordData(contact, { email: 'person@example.test', name: { first: 'A', last: 'Person' } }, 7)).toEqual({ email: 'person@example.test', name: 'A Person' })
  })
  it('rechecks permissions, scopes the source, and recovers a create interrupted after persistence', async () => {
    let existing = false, revoked = false
    const findByID = vi.fn(async () => ({ id: 1, role: revoked ? 'editor' : 'administrator' }))
    const find = vi.fn(async () => ({ docs: existing ? [{ id: 10 }] : [] }))
    const create = vi.fn(async () => { existing = true; throw new Error('Response interrupted after insert') })
    const bind = vi.fn(() => ({ first: async () => ({ answers: JSON.stringify({ email: 'person@example.test', name: { first: 'A', last: 'Person' } }), schema_snapshot: JSON.stringify({ fields }) }) }))
    const platform = { db: { prepare: () => ({ bind }) } } as unknown as FormPlatform
    const payload = { findByID, find, create } as unknown as Payload, handlers = new ActionHandlers()
    registerCMSHandlers(handlers, platform, payload)
    const job = { id: 1, kind: 'contact', site: 'default', event_i_d: 'entry:contact', submission_i_d: '3', revision: 'revision', payload: JSON.stringify({ action: contact }) } as OutboxJob
    await handlers.dispatch(job); await handlers.dispatch(job)
    expect(create).toHaveBeenCalledTimes(1)
    const write = create.mock.calls[0] as unknown as [{ overrideAccess: boolean; req: PayloadRequest; data: { site: string; sourceEntry: number } }]
    expect(write[0]).toMatchObject({ overrideAccess: false, data: { site: 'default', sourceEntry: 3 } })
    expect((write[0].req.context as Record<symbol, unknown>)[FORM_INTERNAL]).toBe(true)
    expect(bind).toHaveBeenCalledWith('3', 'default', 'revision')
    revoked = true
    await expect(handlers.dispatch(job)).rejects.toThrow('no longer has integration permission')
  })
})
