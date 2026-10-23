// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PublicSiteProvider } from '../PublicSiteContext'
import { SavedDrafts } from './SavedDrafts'
import { SurveyResults } from './SurveyResults'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('loads private account drafts through the opened child site', async () => {
  const request = vi.fn().mockResolvedValue({ status: 401, ok: false })
  vi.stubGlobal('fetch', request)
  render(
    <PublicSiteProvider prefix="/sites/region">
      <SavedDrafts
        slug="application"
        refresh="one"
        onResume={async () => true}
        onRevoke={async () => 'Revoked'}
      />
    </PublicSiteProvider>,
  )
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/sites/region/api/forms-runtime/application/drafts',
      expect.any(Object),
    ),
  )
})

it('loads survey results through the opened child site', async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ fields: [] as never[], entries: 0 }) })
  vi.stubGlobal('fetch', request)
  render(
    <PublicSiteProvider prefix="/sites/region">
      <SurveyResults endpoint="/api/forms-surveys/application" />
    </PublicSiteProvider>,
  )
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/sites/region/api/forms-surveys/application',
      expect.any(Object),
    ),
  )
})
