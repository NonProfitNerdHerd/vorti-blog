import { describe, expect, it } from 'vitest'
import { taskURLState, writeTaskURL } from '@/review/dashboard-model'

describe('Personal Dashboard task links', () => {
  it('restores personal overdue and due-soon views without losing the assignment', () => {
    const state = taskURLState(new URLSearchParams('taskView=assigned&due=overdue&page=1'), '9')
    expect(state.filters).toMatchObject({
      assignee: '9',
      due: 'overdue',
      archived: false,
      status: 'active',
      page: 1,
      limit: 10,
    })
    const params = writeTaskURL(
      new URLSearchParams('depth=1'),
      { ...state.filters, due: 'soon', page: 3 },
      state.preset,
    )
    expect(taskURLState(params, '9').filters).toMatchObject({ assignee: '9', due: 'soon', page: 3 })
    expect(params.get('depth')).toBe('1')
  })
  it('rejects unknown presets and enum refinements', () => {
    expect(
      taskURLState(new URLSearchParams('taskView=bad&due=bad&status=bad&page=-1'), '9'),
    ).toMatchObject({ preset: 'all', filters: { due: '', status: 'active', page: 1 } })
  })
})
