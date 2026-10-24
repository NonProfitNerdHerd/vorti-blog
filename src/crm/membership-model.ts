import { givingDate, givingDueOn } from './commitment-model'
export interface MembershipType {
  id: string
  name: string
  eligibility: 'person' | 'household'
  term_months: number
  dues_minor: string
  currency: string
  exponent: number
  archived: number
  revision: number
}
export interface MembershipTerm {
  id: string
  type_id: string
  person_id: string | null
  household_id: string | null
  billing_contact_id: string
  type_name: string
  label: string
  starts_on: string
  ends_on: string
  dues_minor: string
  currency: string
  exponent: number
  dues_commitment_id: string | null
  renewed_from: string | null
  cancelled_on: string | null
  revision: number
}
export function membershipEnd(start: string, months: number): string {
  if (!Number.isInteger(months) || months < 1 || months > 120)
    throw new Error('Choose a membership term between one and 120 months.')
  const next = givingDueOn(start, 'monthly', months)
  if (!next) throw new Error('Choose a membership term ending before year 10000.')
  const date = new Date(next + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
export function membershipStatus(
  term: Pick<MembershipTerm, 'starts_on' | 'ends_on' | 'cancelled_on'>,
  asOf: string,
): 'upcoming' | 'current' | 'expired' | 'cancelled' {
  givingDate(asOf)
  return term.cancelled_on && term.cancelled_on <= asOf
    ? 'cancelled'
    : asOf < term.starts_on
      ? 'upcoming'
      : asOf > term.ends_on
        ? 'expired'
        : 'current'
}
