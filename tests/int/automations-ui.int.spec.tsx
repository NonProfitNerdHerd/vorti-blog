// DOM environment is selected by the dom Vitest project.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AutomationsWorkspace } from '@/automations/Workspace'
import type { AutomationRow } from '@/automations/store'
import type { Definition } from '@/automations/model'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: { id: 7 } }) }))

vi.mock('@/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('Automations backend journey', () => {
  it('creates trigger-first, saves a draft, self-publishes, confirms real writes and inspects a failure before editing', async () => {
    let doc: AutomationRow | undefined
    let run: Record<string, unknown> | undefined
    const calls: Record<string, unknown>[] = []
    const fetch = vi.fn(async (input: string, options?: RequestInit) => {
      const url = new URL(input, 'http://localhost')
      if (url.pathname !== '/api/automations')
        return Response.json({ docs: [{ id: 1, title: 'Accessible source' }] })
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body))
        calls.push(body)
        if (body.action === 'save')
          doc = {
            id: 'workflow',
            site: 'default',
            owner: 7,
            name: body.name,
            draft: JSON.stringify(body.definition),
            revision: 1,
            published: null,
            version: 0,
            active: 0,
            created_at: '2026-10-26T12:00:00Z',
            updated_at: '2026-10-26T12:00:00Z',
          }
        if (body.action === 'publish')
          doc = { ...doc!, published: doc!.draft, version: 1, active: 1, revision: 2 }
        if (body.action === 'test')
          run = {
            id: 'run',
            mode: 'test',
            status: 'failed',
            version: -2,
            created_at: '2026-10-26T12:00:00Z',
            started_at: '2026-10-26T12:00:00Z',
            finished_at: '2026-10-26T12:00:01Z',
            valuesVisible: true,
            definition: JSON.parse(doc!.draft),
            refs: [],
            error: 'Permission denied or resource unavailable.',
            steps: [
              {
                id: (JSON.parse(doc!.draft) as Definition).steps[0].id,
                name: 'Block 1',
                status: 'failed',
                attempts: 1,
                error: 'Permission denied or resource unavailable.',
                inputs: { recordID: '1' },
                output: null,
              },
            ],
          }
        return Response.json({ doc, run })
      }
      if (url.searchParams.has('run')) return Response.json({ run })
      if (url.searchParams.has('id')) return Response.json({ doc, runs: run ? [run] : [] })
      return Response.json({ docs: doc ? [doc] : [] })
    })
    vi.stubGlobal('fetch', fetch)
    render(<AutomationsWorkspace />)
    await screen.findByText('Create a workflow by choosing a template or building your own.')
    fireEvent.click(screen.getByRole('button', { name: 'Create Workflow' }))
    await screen.findByText('Choose a workflow or build your own')
    fireEvent.click(screen.getByRole('button', { name: 'Build from scratch' }))
    expect(screen.getByText('1. Choose a trigger')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Follow up workflow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }))
    await screen.findByRole('option', { name: 'Accessible source' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Accessible record' }), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await screen.findByRole('button', { name: 'Publish own draft' })
    expect(doc!.active).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Publish own draft' }))
    await waitFor(() => expect(doc!.active).toBe(1))
    await screen.findByText(/Published version 1/)
    expect((screen.getByRole('button', { name: 'Test draft' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'I understand this performs real writes.' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Test draft' }))
    await screen.findByText(/Run · failed/)
    expect(calls.find((c) => c.action === 'test')).toMatchObject({
      confirmWrites: true,
      id: 'workflow',
    })
    expect(screen.getAllByText('Permission denied or resource unavailable.').length).toBe(2)
    expect(screen.getByText('Exact definition used')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft and retest' }))
    await screen.findByRole('button', { name: 'Save draft' })
    expect(screen.getByDisplayValue('Follow up workflow')).toBeTruthy()
  })
})
