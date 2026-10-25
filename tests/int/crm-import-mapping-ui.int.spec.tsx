// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { ImportMappingEditor } from '../../src/crm/ImportMappingEditor'
import { importMappingEndpoints } from '../../src/crm/import-mapping-endpoints'
import { ImportReviewRepository } from '../../src/crm/import-review'
import { OrganizationRepository } from '../../src/organizations/repository'
import { errorResponse } from '../../src/crm/plugin'
import type { ImportMapping } from '../../src/crm/import-model'
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api', admin: '/staff' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('persists and reloads reusable field choices, applies only run configuration, and clears private values after revocation', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = await crmImportFixture(),
    authority = new OrganizationRepository(fixture.db, 1),
    key = () => crypto.randomUUID()
  try {
    const revision = () =>
      Number(
        fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
      )
    await authority.setMembership({
      site: 'default',
      user: 2,
      role: 'editor',
      active: true,
      expectedRevision: revision(),
      operationKey: key(),
    })
    const headers = ['External ID', 'Given name', 'Family name'],
      run = key(),
      now = new Date().toISOString()
    fixture.sqlite
      .prepare(
        `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,headers_json,stage_state,created_at,updated_at)
      VALUES(?,'default',2,'Fictional staged source','contacts','Fictional CRM','fictional.csv','csv',1,?,?,?,'review',?,?)`,
      )
      .run(run, 'a'.repeat(64), key(), JSON.stringify(headers), now, now)
    const endpoints = importMappingEndpoints(fixture.db, errorResponse)
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'https://crm.test')
      if (url.origin !== 'https://crm.test') throw Error('Unexpected external mapping request')
      const incoming = new Request(url, {
        ...init,
        headers: { ...init?.headers, origin: url.origin },
      })
      return endpoints
        .find((endpoint) => endpoint.method === (init?.method || 'GET').toLowerCase())!
        .handler({
          url: incoming.url,
          headers: incoming.headers,
          body: incoming.body,
          user: { id: 2, collection: 'users' },
        } as PayloadRequest)
    })
    const configured = vi.fn(async (mapping: ImportMapping) => {
        const current = fixture.sqlite
          .prepare('SELECT revision FROM vc_crm_import_runs WHERE id=?')
          .get(run)!
        await new ImportReviewRepository(fixture.db, 2).mapping({
          site: 'default',
          id: run,
          expectedRevision: Number(current.revision),
          mapping,
          operationKey: key(),
        })
      }),
      onDirty = vi.fn(),
      onDenied = vi.fn()
    const props = {
      api: '/api',
      site: 'default',
      domain: 'contacts' as const,
      headers,
      mapping: null as ImportMapping | null,
      onConfigured: configured,
      onDirty,
      onSaving: vi.fn(),
      onDenied,
    }
    const first = render(<ImportMappingEditor {...props} />)
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'First name source' }).closest('fieldset')!.disabled,
      ).toBe(false),
    )
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save new reusable mapping' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Source record identifier source' }), {
      target: { value: '0' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'First name source' }), {
      target: { value: '1' },
    })
    const last = screen.getByRole('combobox', { name: 'Last name source' })
    fireEvent.change(last, { target: { value: '2' } })
    fireEvent.click(within(last.closest('tr')!).getByRole('checkbox', { name: 'Clear when blank' }))
    fireEvent.change(screen.getByLabelText('Mapping name'), {
      target: { value: 'Fictional legacy donor map' },
    })
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save new reusable mapping' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save new reusable mapping' }))
    await screen.findByText(
      'Reusable mapping saved. Apply the field choices to this import when ready.',
    )
    expect(configured).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply mapping to this import' }))
    await screen.findByText(
      'Field mapping applied to this import. Review the rows before approval.',
    )
    const saved = fixture.sqlite
      .prepare('SELECT id,mapping_json FROM vc_crm_import_mappings')
      .get()!
    expect(
      JSON.parse(String(saved.mapping_json)).columns.find(
        (column: { field: string }) => column.field === 'lastName',
      ).clearBlank,
    ).toBe(true)
    expect(
      fixture.sqlite.prepare('SELECT mapping_json FROM vc_crm_import_runs WHERE id=?').get(run)!
        .mapping_json,
    ).toBe(saved.mapping_json)
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
    first.unmount()
    render(<ImportMappingEditor {...props} />)
    await screen.findByRole('option', { name: 'Fictional legacy donor map' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Saved mapping' }), {
      target: { value: String(saved.id) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load saved mapping' }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('combobox', { name: 'Last name source' }))
          .getByRole('option', { selected: true })
          .getAttribute('value'),
      ).toBe('2'),
    )
    expect((screen.getByLabelText('Mapping name') as HTMLInputElement).value).toBe(
      'Fictional legacy donor map',
    )
    await authority.setRestrictions({
      site: 'default',
      user: 2,
      denied: [{ category: 'identity', operation: 'read' }],
      expectedRevision: revision(),
      operationKey: key(),
    })
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(onDenied).toHaveBeenCalled())
    expect((screen.getByLabelText('Mapping name') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('option', { name: 'Fictional legacy donor map' })).toBeNull()
  } finally {
    fixture.close()
  }
})
