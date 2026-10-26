/** Shared by the staff sidebar and CRM workspace router. */
export const crmSections = [
  ['overview', 'Overview'],
  ['contacts', 'Constituents'],
  ['donations', 'Donations'],
  ['households', 'Households'],
  ['fundraising', 'Campaigns, funds and appeals'],
  ['giving', 'Pledges and recurring'],
  ['memberships', 'Memberships'],
  ['opportunities', 'Opportunities'],
  ['volunteers', 'Volunteers'],
  ['correspondence', 'Receipts and correspondence'],
  ['imports', 'Imports'],
] as const

export function crmView(value: string | null): string {
  if (value === 'attachments' || value === 'record-tasks') return value
  return crmSections.some(([id]) => id === value) ? value! : 'overview'
}

export function crmURL(admin: string, view: string, site?: string | null): string {
  return `${admin}/crm?${new URLSearchParams({ view, ...(site ? { site } : {}) })}`
}
