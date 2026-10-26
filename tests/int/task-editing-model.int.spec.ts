import { describe, expect, it, vi } from 'vitest'
import { TaskSaveQueue } from '../../src/review/task-save-queue'
import { TaskCreationQueue } from '../../src/review/task-creation-queue'
import { calendarTaskSpan, moveTaskDates, timelineRanges } from '../../src/review/task-schedule'
import type { Task } from '../../src/review/client'
import { reconcileTaskSnapshot } from '../../src/review/task-board-state'
const task = (data: Partial<Task> = {}): Task => ({
  id: 1,
  title: 'Task',
  status: 'open',
  priority: 'normal',
  ...data,
})
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
describe('serialized autosave', () => {
  it('does not write an unchanged task', async () => {
    const write = vi.fn(),
      queue = new TaskSaveQueue({ title: 'Original' }, 'r1', write)
    await queue.flush()
    expect(write).not.toHaveBeenCalled()
  })
  it('preserves edits made during a write and uses the acknowledged revision', async () => {
    const first = deferred<string>(),
      calls: unknown[] = []
    const queue = new TaskSaveQueue({ title: 'Original' }, 'r1', async (value, revision) => {
      calls.push([value, revision])
      return calls.length === 1 ? first.promise : 'r3'
    })
    queue.update({ title: 'First' })
    const saving = queue.flush()
    queue.update({ title: 'Intermediate' })
    queue.update({ title: 'Latest' })
    expect(queue.flush()).toBe(saving)
    first.resolve('r2')
    await saving
    expect(calls).toEqual([
      [{ title: 'First' }, 'r1'],
      [{ title: 'Latest' }, 'r2'],
    ])
    expect(queue.dirty).toBe(false)
  })
  it('preserves failed changes for retry without advancing the revision', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(Error('Conflict'), { status: 409 }))
      .mockResolvedValue('r2')
    const queue = new TaskSaveQueue({ title: 'Original' }, 'r1', write)
    queue.update({ title: 'Draft' })
    await expect(queue.flush()).rejects.toThrow('Conflict')
    expect(queue.dirty).toBe(true)
    expect(queue.revision).toBe('r1')
    await queue.flush()
    expect(write).toHaveBeenLastCalledWith({ title: 'Draft' }, 'r1')
  })
})
describe('rapid creation', () => {
  it('accepts multiple roots and children immediately while a parent is pending', async () => {
    const first = deferred<Task>(),
      writes: any[] = [],
      saved: number[] = []
    const queue = new TaskCreationQueue(
      async (data) => {
        writes.push(data)
        return writes.length === 1
          ? first.promise
          : task({ id: 100 + writes.length, title: data.title })
      },
      () => {},
      (_item, task) => saved.push(task.id),
    )
    const parent = queue.enqueue({ title: 'Parent' })
    queue.enqueue({ title: 'Child', parent: parent.temporaryID })
    queue.enqueue({ title: 'Another' })
    expect(queue.items).toHaveLength(3)
    expect(writes).toHaveLength(1)
    first.resolve(task({ id: 101 }))
    await vi.waitFor(() => expect(queue.items).toHaveLength(0))
    expect(writes[1].parent).toBe(101)
    expect(saved).toHaveLength(3)
    expect(new Set(writes.map((data) => data.clientRequestKey)).size).toBe(3)
  })
  it('retains the key on retry and does not submit children of a failed parent', async () => {
    let fail = true
    const writes: any[] = []
    const queue = new TaskCreationQueue(
      async (data) => {
        writes.push(data)
        if (data.title === 'Parent' && fail) throw Error('Offline')
        return task({ id: writes.length + 10 })
      },
      () => {},
      () => {},
    )
    const parent = queue.enqueue({ title: 'Parent' })
    queue.enqueue({ title: 'Child', parent: parent.temporaryID })
    queue.enqueue({ title: 'Independent' })
    await vi.waitFor(() => expect(writes).toHaveLength(2))
    expect(writes.map((item) => item.title)).toEqual(['Parent', 'Independent'])
    fail = false
    queue.retry(parent.temporaryID)
    await vi.waitFor(() => expect(queue.items).toHaveLength(0))
    expect(writes[2].clientRequestKey).toBe(writes[0].clientRequestKey)
    expect(writes[3].parent).toBe(13)
  })
})
describe('schedule dates', () => {
  it('moves a span without changing its duration and rejects inverted resizing', () => {
    const item = task({ startDate: '2026-10-30T12:00:00Z', dueDate: '2026-11-02T12:00:00Z' })
    expect(moveTaskDates(item, 2, 'move')).toEqual({
      startDate: '2026-11-01T12:00:00.000Z',
      dueDate: '2026-11-04T12:00:00.000Z',
    })
    expect(moveTaskDates(item, 4, 'start')).toBeNull()
    expect(timelineRanges).toEqual([7, 14, 28, 60, 90, 120, 180, 240, 365])
  })
  it('uses inclusive open spans and single-date/undated fallbacks', () => {
    expect(
      calendarTaskSpan(task({ startDate: '2026-10-01', dueDate: '2026-10-05' }), 'open', 'UTC'),
    ).toEqual({ start: '2026-10-01', end: '2026-10-05' })
    expect(calendarTaskSpan(task({ startDate: '2026-10-01' }), 'open', 'UTC')).toEqual({
      start: '2026-10-01',
      end: '2026-10-01',
    })
    expect(calendarTaskSpan(task({ status: 'done' }), 'open', 'UTC')).toBeNull()
    expect(calendarTaskSpan(task(), 'due', 'UTC')).toEqual({ start: undefined, end: undefined })
  })
  it('uses the site calendar day for creation timestamps', () => {
    expect(
      calendarTaskSpan(task({ createdAt: '2026-10-26T01:00:00Z' }), 'created', 'America/Chicago'),
    ).toEqual({ start: '2026-10-25', end: '2026-10-25' })
  })
})

describe('board report reconciliation', () => {
  it('does not replace a completed save with a report started before that save', () => {
    const current = task({
      updatedAt: '2026-10-26T22:13:14.090Z',
      startDate: '2026-10-21',
      dueDate: '2026-10-25',
    })
    const older = task({
      updatedAt: '2026-10-26T22:13:01.448Z',
      startDate: '2026-10-20',
      dueDate: '2026-10-23',
    })
    expect(reconcileTaskSnapshot([current], [older], new Set(), new Set())).toEqual([current])
  })
  it('keeps pending optimistic dates and accepts a later authoritative revision', () => {
    const current = task({ updatedAt: 'r1', dueDate: '2026-10-25' }),
      incoming = task({ updatedAt: 'r1', dueDate: '2026-10-23' })
    expect(reconcileTaskSnapshot([current], [incoming], new Set([1]), new Set())).toEqual([current])
    const latest = task({ updatedAt: 'r2', dueDate: '2026-10-26' })
    expect(reconcileTaskSnapshot([current], [latest], new Set(), new Set())).toEqual([latest])
  })
  it('retains unconfirmed creations while removing records absent from an authoritative report', () => {
    const pending = task({ id: -1 }),
      created = task({ id: 2 }),
      removed = task({ id: 3 })
    expect(reconcileTaskSnapshot([pending, created, removed], [], new Set(), new Set([2]))).toEqual(
      [pending, created],
    )
  })
})
