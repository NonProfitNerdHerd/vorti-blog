export const volunteerParticipationStates = ['registered', 'attended', 'cancelled'] as const
export const volunteerInvitationResponses = [
  'pending',
  'accepted',
  'declined',
  'withdrawn',
] as const
export const volunteerHourStates = ['submitted', 'approved', 'rejected'] as const
export interface VolunteerProfile {
  site_id: string
  constituent_id: string
  label: string
  skills: string[]
  interests: string[]
  availability: string
  do_not_contact: number
  contact_allowed: number
  archived: number
  revision: number
}
export interface VolunteerActivity {
  id: string
  site_id: string
  name: string
  description: string
  location: string
  starts_on: string
  ends_on: string
  skills: string[]
  state: 'planned' | 'completed' | 'cancelled'
  archived: number
  revision: number
}
export interface VolunteerParticipation {
  id: string
  activity_id: string
  constituent_id: string
  label: string
  state: (typeof volunteerParticipationStates)[number]
  notes: string
  revision: number
}
export interface VolunteerInvitation {
  id: string
  activity_id: string
  constituent_id: string
  label: string
  activity_name: string
  channel: 'phone' | 'email' | 'letter' | 'other'
  occurred_on: string
  notes: string
  response: (typeof volunteerInvitationResponses)[number]
  responded_on: string | null
  response_notes: string
  revision: number
}
export interface VolunteerHours {
  id: string
  activity_id: string
  constituent_id: string
  activity_name: string
  label: string
  occurred_on: string
  minutes: number
  state: (typeof volunteerHourStates)[number]
  review_reason: string
  revision: number
  created_at: string
}
