export interface CRMSearchResult {
  section: string
  subtype: string
  id: string
  label: string
  detail: string
}
export interface CRMSearchPage {
  docs: CRMSearchResult[]
  total: number
  page: number
}
export const searchSections = [
  ['all', 'All'], ['contacts', 'Contacts'], ['organizations', 'Organizations'],
  ['donations', 'Donations'], ['households', 'Households'], ['fundraising', 'Campaigns, funds and appeals'],
  ['giving', 'Pledges and recurring'], ['memberships', 'Memberships'],
  ['opportunities', 'Opportunities'], ['volunteers', 'Volunteers'],
] as const
export function searchResultURL(admin: string, site: string, result: CRMSearchResult): string {
  const p = new URLSearchParams({ view: result.section, site, result: result.id, resultType: result.subtype })
  if (result.section === 'contacts' || result.section === 'organizations') {
    p.set('contact', result.id)
    p.set('contactTab', 'information')
    p.set('infoSection', 'profile')
  }
  if (result.section === 'households') p.set('household', result.id)
  if (result.section === 'volunteers') {
    p.set('volunteerView', result.subtype === 'profile' ? 'profiles' : result.subtype === 'hours' ? 'hours' : 'activities')
  }
  return `${admin}/crm?${p}`
}
