// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SubSitesNavigation } from '../../src/organizations/SubSitesNavigation'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

function settingsTabs() {
  return render(
    <>
      <SubSitesNavigation />
      <button
        className="tabs-field__tab-button"
        onClick={(event) => event.currentTarget.classList.add('tabs-field__tab-button--active')}
      >
        SubSites
      </button>
    </>,
  )
}

it('keeps a URL-selected SubSites tab through an asynchronous native preference restore', async () => {
  window.history.replaceState({}, '', '/admin/globals/site-settings?tab=SubSites')
  const view = settingsTabs()
  const tab = screen.getByRole('button', { name: 'SubSites' })
  await waitFor(() => expect(tab.classList.contains('tabs-field__tab-button--active')).toBe(true))
  await act(async () => {
    tab.classList.remove('tabs-field__tab-button--active')
    await Promise.resolve()
  })
  await waitFor(() => expect(tab.classList.contains('tabs-field__tab-button--active')).toBe(true))
  view.unmount()
})

it('leaves the native saved tab alone when SubSites was not selected in the URL', async () => {
  settingsTabs()
  await act(async () => {
    await Promise.resolve()
  })
  expect(
    screen
      .getByRole('button', { name: 'SubSites' })
      .classList.contains('tabs-field__tab-button--active'),
  ).toBe(false)
})
