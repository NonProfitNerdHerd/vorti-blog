// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContactPicker } from '../../src/crm/HouseholdWorkspace'
import { ContactRepository } from '../../src/crm/contacts'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'

vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('reaches every matching constituent, resets pagination on search, and clears chapter choices before reload', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = await crmTimelineFixture()
  try {
    const contacts = new ContactRepository(fixture.db, 1)
    for (let index = 0; index < 28; index++)
      await contacts.create({
        site: 'default',
        profile: { kind: 'person', firstName: `Picker donor ${String(index).padStart(2, '0')}` },
        roles: ['donor'],
        operationKey: crypto.randomUUID(),
      })
    let revoked = false
    const onChange = vi.fn()
    vi.stubGlobal('fetch', async (url: string) => {
      const params = new URL(url, 'https://crm.test').searchParams
      if (revoked || params.get('site') !== 'default')
        return Response.json({ message: 'Contact access denied.' }, { status: 403 })
      return Response.json(
        await contacts.list({
          site: 'default',
          search: params.get('search') || '',
          limit: Number(params.get('limit')),
          ...(params.get('afterID')
            ? { after: { id: params.get('afterID')!, label: params.get('afterLabel')! } }
            : {}),
        }),
      )
    })
    const mounted = render(
      <ContactPicker api="/api" site="default" label="Donor" value="" onChange={onChange} />,
    )
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search donor' }), {
      target: { value: 'Picker donor' },
    })
    await screen.findByText('28 matching contacts')
    expect(screen.queryByRole('option', { name: 'Picker donor 27' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next donor choices' }))
    const last = await screen.findByRole('option', { name: 'Picker donor 27' })
    const id = last.getAttribute('value')!
    fireEvent.change(screen.getByRole('combobox', { name: 'Donor' }), { target: { value: id } })
    expect(onChange).toHaveBeenLastCalledWith(id)
    mounted.rerender(
      <ContactPicker api="/api" site="default" label="Donor" value={id} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'First donor choices' }))
    await screen.findByRole('option', { name: 'Picker donor 00' })
    expect(screen.getByRole('option', { name: 'Selected contact' }).getAttribute('value')).toBe(id)
    fireEvent.click(screen.getByRole('button', { name: 'Next donor choices' }))
    await screen.findByRole('option', { name: 'Picker donor 27' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search donor' }), {
      target: { value: 'Picker donor 00' },
    })
    await screen.findByText('1 matching contacts')
    await screen.findByRole('option', { name: 'Picker donor 00' })
    revoked = true
    fireEvent(window, new Event('focus'))
    await screen.findByRole('alert')
    expect(screen.queryByRole('option', { name: 'Picker donor 00' })).toBeNull()
    expect(
      (screen.getByRole('combobox', { name: 'Donor' }) as unknown as { disabled: boolean })
        .disabled,
    ).toBe(true)
    mounted.rerender(
      <ContactPicker
        api="/api"
        site="another-chapter"
        label="Donor"
        value=""
        onChange={onChange}
      />,
    )
    expect(screen.queryByRole('option', { name: 'Picker donor 00' })).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Contact access denied.'),
    )
  } finally {
    cleanup()
    fixture.close()
  }
})
