const key = 'vorti-dashboard-sidebar'

/** Use normal collection writes: the D1 adapter's preference upsert cannot create a new row. */
export async function saveDashboardSidebar(api: string, open: boolean) {
  const existing = await fetch(`${api}/payload-preferences/${key}`, { credentials: 'same-origin' })
  if (!existing.ok) throw new Error('Could not read sidebar preference.')
  const preference = (await existing.json()) as { id?: string | number }
  const response = await fetch(
    `${api}/payload-preferences${preference.id ? `/${preference.id}` : ''}?depth=0`,
    {
      method: preference.id ? 'PATCH' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: { open } }),
    },
  )
  if (!response.ok) throw new Error('Could not save sidebar preference. Please try again.')
}
