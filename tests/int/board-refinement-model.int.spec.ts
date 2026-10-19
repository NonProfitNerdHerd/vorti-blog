import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { up, down } from '@/migrations/20261019_173505_board_refinement'
import {
  groupValues,
  groupFieldValue,
  editableGroup,
  type GroupTask,
} from '@/review/board-grouping'
import { workspaceFormula, workspaceReferences } from '@/review/workspace-formula'
import { nativeFormulaValue } from '@/review/formula-inputs'
import {
  calendarPeriod,
  shiftCalendar,
  calendarAnchor,
  calendarModeValue,
} from '@/review/BoardCalendar'
describe('board refinement model and additive migration', () => {
  it('resets only List/Board groups, preserves all other preferences and adds only missing timelines', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec(
      "CREATE TABLE review_tasks(id integer,title text,status text,updated_at text); CREATE TABLE task_boards(id integer); CREATE TABLE task_views(id integer PRIMARY KEY,board_id integer,name text,kind text,position real,default_view integer); CREATE TABLE task_board_preferences(id integer,board_id integer,view_settings text); INSERT INTO task_boards VALUES(1),(2),(3); INSERT INTO review_tasks VALUES(1,'Keep task','done','2020-01-01'); INSERT INTO task_views VALUES(10,1,'List','list',0,1),(11,1,'Board','board',1,0),(12,1,'Calendar','calendar',2,0),(13,1,'Custom Gantt','gantt',3,0),(14,3,'Existing timeline','timeline',0,1);",
    )
    const settings = {
      '10': { group: 'assignee', columns: { title: { width: 400 } }, boardSearch: 'keep' },
      '11': { group: 'field:8' },
      '12': { group: 'section', calendarRange: 'week' },
      note: 'keep',
      flag: true,
    }
    db.prepare('INSERT INTO task_board_preferences VALUES(1,1,?)').run(JSON.stringify(settings))
    const adapter = {
      run: async (s: { queryChunks: { value: string[] }[] }) =>
        db.exec(s.queryChunks.map((c) => c.value.join('')).join('')),
    }
    await up({ db: adapter } as never)
    const saved = JSON.parse(
      (
        db.prepare('SELECT view_settings FROM task_board_preferences').get() as {
          view_settings: string
        }
      ).view_settings,
    )
    expect(saved).toEqual({
      ...settings,
      '10': { ...settings['10'], group: 'status' },
      '11': { group: 'status' },
    })
    expect(
      db.prepare('SELECT name,kind,default_view FROM task_views WHERE board_id=2').all(),
    ).toEqual([{ name: 'Timeline', kind: 'gantt', default_view: 0 }])
    expect(db.prepare('SELECT count(*) total FROM task_views WHERE board_id=1').get()).toEqual({
      total: 4,
    })
    expect(
      db.prepare('SELECT title,status,updated_at,completed_at FROM review_tasks').get(),
    ).toEqual({ title: 'Keep task', status: 'done', updated_at: '2020-01-01', completed_at: null })
    await expect(down({} as never)).rejects.toThrow('recovery point')
    db.close()
  })
  it('groups all selected values without duplicating records or leaking restricted results', () => {
    const definition = {
      id: 1,
      name: 'Category',
      kind: 'multi-select',
      updatedAt: '',
      configuration: {
        options: [
          { id: 'a', label: 'Health' },
          { id: 'b', label: 'Home' },
        ],
      },
    }
    const task = {
      id: 1,
      title: 'Test',
      status: 'open',
      priority: 'normal',
      fields: [{ definition, value: ['a', 'b'] }],
    } satisfies GroupTask
    expect(groupValues(task, 'field:1', '')).toEqual([
      { key: 'a', label: 'Health' },
      { key: 'b', label: 'Home' },
    ])
    expect(groupFieldValue(definition, 'c', ['a', 'b'], 'a')).toEqual(['b', 'c'])
    expect(
      groupValues(
        { ...task, fields: [{ definition, value: null, error: 'restricted' }] },
        'field:1',
        '',
      ),
    ).toEqual([{ key: '!unavailable', label: 'Unavailable' }])
    expect(groupValues(task, 'completedAt', '')[0].label).toBe('No completion date')
    expect(editableGroup('creator')).toBe(false)
    expect(editableGroup('field:1', { ...definition, kind: 'formula' })).toBe(false)
  })
  it('supports native and typed collection formula inputs while preserving safe expressions', () => {
    expect(workspaceReferences('concat([ntitle],join([f2],", "))')).toEqual(['ntitle', 'f2'])
    expect(workspaceFormula('count([f2])+[nid]', { f2: ['a', 'b'], nid: 3 })).toBe(5)
    expect(workspaceFormula('join([f2],", ")', { f2: ['a', 'b'] })).toBe('a, b')
    expect(workspaceFormula('[f1]*2', { f1: 4 })).toBe(8)
    expect(() => workspaceFormula('[f2]+1', { f2: ['a'] })).toThrow('numbers')
    expect(() => workspaceFormula('fetch("https://example.com")', {})).toThrow()
    expect(() => nativeFormulaValue({}, 'nsecret')).toThrow('Unknown')
  })
  it('paginates months and weeks without overflow or shifting date-only deadlines', () => {
    expect(calendarModeValue('invalid')).toBe('month')
    expect(calendarAnchor('2026-02-31')).not.toBe('2026-02-31')
    expect(shiftCalendar('2026-01-31', 'month', 1)).toBe('2026-02-01')
    expect(shiftCalendar('2026-12-31', 'agenda', 1)).toBe('2027-01-01')
    expect(shiftCalendar('2026-03-08', 'week', 1)).toBe('2026-03-15')
    expect(calendarPeriod('2026-10-21', 'week')).toEqual({
      start: '2026-10-19',
      end: '2026-10-26',
      days: 7,
    })
    expect(calendarPeriod('2026-02-20', 'agenda')).toEqual({
      start: '2026-02-01',
      end: '2026-03-01',
      days: 42,
    })
  })
})
