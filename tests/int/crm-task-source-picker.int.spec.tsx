// DOM environment is selected by the dom Vitest project.
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CRMTaskSourcePicker, crmTaskSourceHref } from '../../src/review/CRMTaskSourcePicker'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('selects a record from the pinned site and opens its workspace', async () => {
  const request = vi.fn(async (url: string) => {
    const query = new URL(url, 'https://example.test').searchParams
    expect(query.get('site')).toBe('chapter-a')
    return { ok: true, json: async () => ({ docs: query.get('type') === 'campaign' ? [{ id: 'campaign-1', label: 'Community drive', revision: 3, authorityRevision: 8 }] : [] }) }
  })
  vi.stubGlobal('fetch', request)
  const choose = vi.fn()
  render(<CRMTaskSourcePicker api="/api" site="chapter-a" value={null} onChange={choose} />)
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'campaign' } })
  fireEvent.click(await screen.findByRole('option', { name: 'Community drive' }))
  expect(choose).toHaveBeenCalledWith({ site: 'chapter-a', type: 'campaign', id: 'campaign-1', label: 'Community drive', revision: 3, authorityRevision: 8 })
  expect(crmTaskSourceHref('/admin', 'chapter-a', 'campaign', 'campaign-1')).toContain('result=campaign-1')
})

it('does not offer records when the selected type is denied', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ message: 'Denied' }) })))
  render(<CRMTaskSourcePicker api="/api" site="chapter-a" value={null} onChange={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('cannot link'))
  expect(within(screen.getByRole('listbox')).queryAllByRole('option')).toHaveLength(0)
})
