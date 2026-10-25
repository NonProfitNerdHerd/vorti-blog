// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Config, PayloadRequest } from 'payload'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { importStorage } from '../helpers/crm-import-storage'
import { crmModule } from '../../src/crm/plugin'
import { CRMJobs } from '../../src/crm/jobs'
import { importJob } from '../../src/crm/import-job'
import { ImportWorkspace } from '../../src/crm/ImportWorkspace'
import type { CRMJobWake } from '../../src/crm/job-dispatch'
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('completes upload, preview, staging, mapping, bulk review, explicit approval and persisted results through registered endpoints', async () => {
  vi.stubGlobal('crypto', webcrypto)
  window.history.replaceState(null, '', '/admin/crm?site=default&view=imports')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const fixture = await crmImportFixture(),
    bucket = importStorage(),
    wakes: CRMJobWake[] = []
  let pauseDispatch = false
  try {
    const runner = new CRMJobs(fixture.db),
      handlers = { 'import-apply': importJob(fixture.db, bucket.storage) },
      config = crmModule({
        db: fixture.db,
        storage: bucket.storage,
        queue: {
          send: async (body: CRMJobWake) => {
            wakes.push(body)
            if (pauseDispatch) return
            // Deterministic transport for this rendered journey; Queue redelivery is tested separately.
            for (let step = 0; step < 50; step++)
              if (!(await runner.tick(handlers, body.job))) break
          },
        },
      })({} as Config)
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = new URL(input, window.location.origin),
        incoming = new Request(url, { ...init, headers: { ...init?.headers, origin: url.origin } }),
        path = url.pathname.replace(/^\/api/, ''),
        method = (init?.method || 'GET').toLowerCase(),
        endpoint = config.endpoints!.find((entry) => entry.path === path && entry.method === method)
      if (!endpoint) throw Error(`Unexpected endpoint ${method} ${path}`)
      return endpoint.handler({
        url: incoming.url,
        headers: incoming.headers,
        body: incoming.body,
        user: { id: 1, collection: 'users' },
      } as PayloadRequest)
    })
    render(<ImportWorkspace api="/api" site="default" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start an import' }))
    fireEvent.change(screen.getByLabelText('Import name'), {
      target: { value: 'Connected migration' },
    })
    fireEvent.change(screen.getByLabelText('Source platform or dataset'), {
      target: { value: 'Legacy' },
    })
    const text = 'ID,Name\r\nA,Fictional Ada\r\nB,Fictional Bea\r\n',
      file = new File([text], 'donors.csv')
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(text).buffer,
    })
    fireEvent.change(screen.getByLabelText('CSV or XLSX file'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload and preview' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview source' }))
    await screen.findByText('Fictional Ada')
    fireEvent.click(screen.getByRole('button', { name: 'Use these columns' }))
    const stage = await screen.findByRole('button', { name: 'Prepare source rows for mapping' })
    await waitFor(() => expect((stage as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(stage)
    const source = await screen.findByLabelText('Source record identifier source')
    await waitFor(() =>
      expect((source.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false),
    )
    fireEvent.change(source, { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('First name source'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply mapping to this import' }))
    const bulk = await screen.findByRole('button', { name: 'Prepare undecided row reviews' })
    await waitFor(() =>
      expect((bulk.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false),
    )
    const count = () =>
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n
    expect(count()).toBe(1)
    fireEvent.click(bulk)
    const approve = await screen.findByRole('button', {
      name: 'Approve and apply reviewed records',
    })
    await waitFor(() =>
      expect(
        (approve as HTMLButtonElement).disabled ||
          (approve.closest('fieldset') as HTMLFieldSetElement).disabled,
      ).toBe(false),
    )
    expect(count()).toBe(1)
    fireEvent.click(approve)
    await screen.findByRole('button', { name: 'Prepare full results CSV' })
    await waitFor(() => expect(count()).toBe(3))
    expect(wakes).toHaveLength(3)
    expect(wakes.every((body) => Object.keys(body).sort().join(',') === 'job,v')).toBe(true)
    const savedID = new URLSearchParams(window.location.search).get('importID')!
    cleanup()
    render(<ImportWorkspace api="/api" site="default" />)
    await screen.findByRole('heading', { name: 'Connected migration' })
    expect(new URLSearchParams(window.location.search).get('importID')).toBe(savedID)
    await screen.findByText(/2 applied · 2 created/)
    const prepareResults = await screen.findByRole('button', { name: 'Prepare full results CSV' })
    await waitFor(() =>
      expect(
        (prepareResults.closest('fieldset') as unknown as { disabled: boolean }).disabled,
      ).toBe(false),
    )
    fireEvent.click(prepareResults)
    const download = await screen.findByRole('link', { name: 'Download full results CSV' })
    const response = await fetch(download.getAttribute('href')!)
    expect(response.ok).toBe(true)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-import-matching-rows')).toBe('2')
    const results = await response.text()
    expect(results).toContain('Fictional Ada')
    expect(results).toContain('Fictional Bea')
    expect(count()).toBe(3)
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_export_files').get()!.n,
    ).toBe(1)
    cleanup()
    render(<ImportWorkspace api="/api" site="default" />)
    await screen.findByRole('link', { name: 'Download full results CSV' })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare error rows CSV' }))
    const errorDownload = await screen.findByRole('link', { name: 'Download error rows CSV' })
    const errors = await fetch(errorDownload.getAttribute('href')!)
    expect(errors.ok).toBe(true)
    expect(errors.headers.get('x-import-matching-rows')).toBe('0')
    expect(await errors.text()).not.toContain('Fictional Ada')
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_export_files').get()!.n,
    ).toBe(2)
    pauseDispatch = true
    fireEvent.click(screen.getByRole('button', { name: 'Prepare full results CSV' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel result file' }))
    const resume = await screen.findByRole('button', { name: 'Resume result file' })
    await waitFor(() => expect((resume as unknown as { disabled: boolean }).disabled).toBe(false))
    pauseDispatch = false
    fireEvent.click(resume)
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'Download full results CSV' })).toHaveLength(2),
    )
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_export_files').get()!.n,
    ).toBe(3)
    expect(count()).toBe(3)
  } finally {
    cleanup()
    fixture.close()
  }
})
