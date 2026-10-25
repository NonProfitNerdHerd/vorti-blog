// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportMappingEditor } from '../../src/crm/ImportMappingEditor'
vi.mock('@payloadcms/ui', () => ({ Gutter: (): null => null }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({ useAdminSite: () => ({}) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('selects a named fixed fund through chapter/run-scoped choices and applies only the field configuration', async () => {
  const configured = vi.fn(async () => {}),
    requests: URL[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, 'https://crm.test')
    requests.push(url)
    return Response.json(
      url.pathname.endsWith('import-mappings')
        ? { docs: [], total: 0, next: null, canEdit: true }
        : new URL(input, 'https://crm.test').searchParams.get('view') === 'values'
          ? { docs: [{ value: 'OLD_ANNUAL', occurrences: 12, position: 1 }], total: 1, next: null }
          : { docs: [{ id: 'annual-fund', label: 'Annual fund' }], next: null },
    )
  })
  render(
    <ImportMappingEditor
      api="/api"
      site="chapter-a"
      domain="gifts"
      runID="run-a"
      headers={['Amount']}
      mapping={null}
      onConfigured={configured}
      onDirty={vi.fn()}
      onSaving={vi.fn()}
      onDenied={vi.fn()}
    />,
  )
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Fund source').closest('fieldset') as HTMLFieldSetElement).disabled,
    ).toBe(false),
  )
  fireEvent.change(screen.getByLabelText('Fund source'), { target: { value: 'fixed' } })
  fireEvent.click(screen.getByRole('button', { name: 'Choose fund record' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Use Annual fund' }))
  expect((screen.getByLabelText('Fund fixed value') as HTMLInputElement).value).toBe('annual-fund')
  expect(configured).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Apply mapping to this import' }))
  await waitFor(() => expect(configured).toHaveBeenCalledOnce())
  expect(configured.mock.calls[0]).toMatchObject([
    {
      domain: 'gifts',
      columns: [
        { field: 'fund', value: 'annual-fund', clearBlank: false, referenceMode: 'record' },
      ],
    },
  ])
  const choices = requests.find((url) => url.searchParams.get('view') === 'references')!
  expect(choices.searchParams.get('site')).toBe('chapter-a')
  expect(choices.searchParams.get('id')).toBe('run-a')
  expect(choices.searchParams.get('field')).toBe('fund')
})

it('translates a legacy fund code to an explicitly selected fund while retaining the source column', async () => {
  const configured = vi.fn(async () => {})
  vi.stubGlobal('fetch', async (input: string) =>
    Response.json(
      input.includes('import-mappings')
        ? { docs: [], total: 0, next: null, canEdit: true }
        : new URL(input, 'https://crm.test').searchParams.get('view') === 'values'
          ? { docs: [{ value: 'OLD_ANNUAL', occurrences: 12, position: 1 }], total: 1, next: null }
          : { docs: [{ id: 'annual-fund', label: 'Annual fund' }], next: null },
    ),
  )
  render(
    <ImportMappingEditor
      api="/api"
      site="chapter-a"
      domain="gifts"
      runID="run-a"
      headers={['Fund code']}
      mapping={null}
      onConfigured={configured}
      onDirty={vi.fn()}
      onSaving={vi.fn()}
      onDenied={vi.fn()}
    />,
  )
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Fund source').closest('fieldset') as HTMLFieldSetElement).disabled,
    ).toBe(false),
  )
  fireEvent.change(screen.getByLabelText('Fund source'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Translate fund values' }))
  fireEvent.click(screen.getByRole('button', { name: 'Browse distinct source values' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Translate source value 1' }))
  expect((screen.getByLabelText('Fund original value 1') as HTMLInputElement).value).toBe(
    'OLD_ANNUAL',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Choose fund for value 1' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Use Annual fund' }))
  expect((screen.getByLabelText('Fund translated value 1') as HTMLInputElement).value).toBe(
    'annual-fund',
  )
  expect(
    screen.getByLabelText('Fund source').querySelector('option:checked')?.getAttribute('value'),
  ).toBe('0')
  expect(configured).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Apply mapping to this import' }))
  await waitFor(() => expect(configured).toHaveBeenCalledOnce())
  expect(configured.mock.calls[0]).toMatchObject([
    {
      version: 2,
      columns: [
        {
          field: 'fund',
          column: 0,
          unmatched: 'error',
          translations: [{ source: 'OLD_ANNUAL', value: 'annual-fund' }],
        },
      ],
    },
  ])
})
