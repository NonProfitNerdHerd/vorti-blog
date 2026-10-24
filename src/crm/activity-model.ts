export const activityKinds = ['note', 'phone', 'email', 'letter', 'meeting', 'other'] as const
export interface Activity {
  id: string
  constituent_id: string
  kind: (typeof activityKinds)[number]
  subject: string
  body: string
  occurred_on: string
  revision: number
  archived: number
  created_at: string
  created_by: number
}
