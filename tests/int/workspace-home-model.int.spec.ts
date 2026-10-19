import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPersonalTasks } from '@/review/personal-tasks'
afterEach(() => vi.unstubAllGlobals())
describe('Tasks Home personal summary', () => {
  it('uses access-controlled counts independent of the five displayed rows, and fills undated last', async () => {
    const calls: URL[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://localhost')
        calls.push(url)
        const where = JSON.parse(url.searchParams.get('where')!)
        expect(JSON.stringify(where)).toContain('assignee')
        if (url.pathname.endsWith('/count'))
          return Response.json({
            totalDocs: [27, 8, 11][calls.filter((x) => x.pathname.endsWith('/count')).length - 1],
          })
        return Response.json({
          docs:
            url.searchParams.get('limit') === '5'
              ? [{ id: 1 }, { id: 2 }]
              : [{ id: 3 }, { id: 4 }, { id: 5 }],
        })
      }),
    )
    const result = await loadPersonalTasks('/api', '12', '2026-10-19')
    expect(result.counts).toEqual([27, 8, 11])
    expect(result.docs.map((x) => x.id)).toEqual([1, 2, 3, 4, 5])
    expect(calls[3].searchParams.get('sort')).toBe('dueDate,-updatedAt')
    expect(calls[4].searchParams.get('limit')).toBe('3')
    expect(JSON.stringify(JSON.parse(calls[1].searchParams.get('where')!))).toContain(
      '2026-10-19T00:00:00.000Z',
    )
    expect(JSON.stringify(JSON.parse(calls[2].searchParams.get('where')!))).toContain(
      '2026-10-27T00:00:00.000Z',
    )
  })
  it('fails the widget instead of presenting provider failures as zero tasks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Unavailable' }, { status: 503 })),
    )
    await expect(loadPersonalTasks('/api', '12', '2026-10-19')).rejects.toThrow('Unavailable')
  })
})
