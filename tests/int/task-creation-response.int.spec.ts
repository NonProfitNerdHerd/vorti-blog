import { beforeAll, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { fixtureOperator } from '../helpers/native-authority'
import { createTaskOnce } from '@/review/task-creation'
import type { User } from '@/payload-types'
let payload: Payload, actor: User
beforeAll(async () => {
  payload = await getPayload({ config })
  actor = await fixtureOperator(payload)
})
it('returns the normal authorized task projection on both creation and retry, keeping private keys private', async () => {
  const req = () => createLocalReq({ user: { ...actor, collection: 'users' } }, payload)
  const board = await payload.create({
    collection: 'task-boards',
    req: await req(),
    overrideAccess: false,
    data: { name: 'Creation response test', owner: actor.id, visibility: 'private' },
  })
  const input = {
    title: 'Private retry metadata',
    initialBoard: board.id,
    clientRequestKey: crypto.randomUUID(),
  }
  const created = (await createTaskOnce(await req(), input)) as unknown as Record<string, unknown>
  const retried = (await createTaskOnce(await req(), input)) as unknown as Record<string, unknown>
  expect(retried.id).toBe(created.id)
  for (const doc of [created, retried]) {
    expect(doc.creationKey).toBeUndefined()
    expect(doc.creationSignature).toBeUndefined()
    expect(doc.canEdit).toBe(true)
    expect(doc.title).toBe(input.title)
  }
  const concurrent = {
    ...input,
    title: 'Concurrent private response',
    clientRequestKey: crypto.randomUUID(),
  }
  const [first, second] = await Promise.all([
    createTaskOnce(await req(), concurrent),
    createTaskOnce(await req(), concurrent),
  ])
  expect(first.id).toBe(second.id)
  await expect(createTaskOnce(await req(), { ...input, title: 'Changed request' })).rejects.toThrow(
    'different task',
  )
})
