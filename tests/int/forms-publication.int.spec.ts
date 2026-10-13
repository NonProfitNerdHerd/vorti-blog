import { expect, it } from 'vitest'
import { isFormDraftOperation } from '@/forms/publication'

it('uses Payload publication precedence instead of trusting the draft query alone', () => {
  expect(isFormDraftOperation('update', { draft: true, data: { _status: 'published' } })).toBe(false)
  expect(isFormDraftOperation('update', { draft: true, data: { _status: 'draft' } })).toBe(true)
  expect(isFormDraftOperation('update', { draft: true })).toBe(true)
  expect(isFormDraftOperation('update', { data: { _status: 'draft' } })).toBe(false)
  expect(isFormDraftOperation('create', { draft: true, data: { _status: 'published' } })).toBe(true)
  for (const operation of ['create', 'update'] as const) {
    expect(isFormDraftOperation(operation, { draft: true, publishAllLocales: true })).toBe(false)
  }
})
