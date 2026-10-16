// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContactInput } from './ContactInput'
import { WidthControl } from './WidthControl'
import { RankingInput } from './RankingInput'

afterEach(cleanup)
it('pastes US numbers, edits segments and can clear the optional answer', () => {
  const change = vi.fn()
  function Input() { const [value, setValue] = React.useState<string>(''); return <ContactInput field={{ id: 'p', kind: 'phone', label: 'Phone', contact: { format: 'us' } }} id="phone" value={value} onChange={next => { change(next); setValue(String(next)) }} /> }
  render(<Input />)
  fireEvent.paste(screen.getByLabelText('Area code'), { clipboardData: { getData: () => '+1 (312) 555-0123' } })
  expect((screen.getByLabelText('Area code') as HTMLInputElement).value).toBe('312')
  expect((screen.getByLabelText('Four digits') as HTMLInputElement).value).toBe('0123')
  for (const label of ['Area code', 'Three digits', 'Four digits']) fireEvent.change(screen.getByLabelText(label), { target: { value: '' } })
  expect(change).toHaveBeenLastCalledWith('')
})
it('keeps legacy widths on focus/blur and accepts fractions and percentages', () => {
  const change = vi.fn()
  render(<WidthControl value={1 / 3} onChange={change} />)
  fireEvent.blur(screen.getByLabelText('Width'))
  expect(change).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '.6' } }); fireEvent.blur(screen.getByLabelText('Width'))
  expect(change).toHaveBeenLastCalledWith(.6)
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '27%' } }); fireEvent.blur(screen.getByLabelText('Width'))
  expect(change).toHaveBeenLastCalledWith(.27)
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '9%' } }); fireEvent.blur(screen.getByLabelText('Width'))
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(change).toHaveBeenCalledTimes(2)
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '33%' } }); fireEvent.blur(screen.getByLabelText('Width'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(change).toHaveBeenCalledTimes(2)
})
it('shows ranking handles and retains explicit confirmation', () => {
  const change = vi.fn()
  render(<RankingInput field={{ id: 'r', kind: 'ranking', label: 'Rank', options: [{ id: 'a', label: 'A', value: 'a' }, { id: 'b', label: 'B', value: 'b' }] }} id="rank" value={undefined} onChange={change} />)
  expect(screen.getByRole('button', { name: 'Reorder A' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Move up/ })).toBeNull()
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm this ranking' }))
  expect(change).toHaveBeenLastCalledWith(['a', 'b'])
})
