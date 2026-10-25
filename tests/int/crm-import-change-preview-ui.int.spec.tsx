// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ImportChangePreview } from '../../src/crm/ImportChangePreview'
afterEach(cleanup)

it('shows exact financial strings and complete nested values while distinguishing missing, blank, null and false', () => {
  const before = {
    profile: { firstName: 'Original', phone: '', consent: true },
    amount: '90071992547409931',
    unchanged: 0,
  }
  const after = {
    profile: { firstName: 'Reviewed', phone: null as null, consent: false },
    amount: '90071992547409932',
    allocations: [
      { fund: 'General', minorUnits: '1' },
      { fund: 'Restricted', minorUnits: '90071992547409931' },
    ],
    empty: [] as unknown[],
    notes: '<script>fictional</script>',
  }
  render(<ImportChangePreview before={before} after={after} />)
  const table = within(screen.getByRole('region', { name: 'Field comparison' })).getByRole('table')
  const row = (name: string) =>
    within(within(table).getByRole('rowheader', { name }).closest('tr')!)
  expect(
    row('amount')
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['90071992547409931', '90071992547409932'])
  expect(
    row('profile → phone')
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['Blank text', 'No value (null)'])
  expect(
    row('profile → consent')
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['Yes', 'No'])
  expect(
    row('unchanged')
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['0', 'Not present'])
  expect(row('allocations → 2 → minor Units').getByText('90071992547409931')).toBeTruthy()
  expect(row('empty').getByText('Empty list')).toBeTruthy()
  expect(row('notes').getByText('<script>fictional</script>')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByText('Inspect original review snapshots')).toBeTruthy()
})
