export const timelineGroups = [
  'profile',
  'relationships',
  'communications',
  'giving',
  'memberships',
  'opportunities',
  'volunteers',
  'correspondence',
  'attachments',
] as const
export type TimelineGroup = (typeof timelineGroups)[number]
export const timelineLabels: Record<TimelineGroup, string> = {
  profile: 'Constituent and chapter',
  relationships: 'Households and relationships',
  communications: 'Notes and communications',
  giving: 'Gifts, pledges and recurring',
  memberships: 'Memberships',
  opportunities: 'Opportunities',
  volunteers: 'Volunteer activity',
  correspondence: 'Issued correspondence',
  attachments: 'Private attachments',
}
export type TimelineEvent = {
  id: string
  at: string | null
  group: TimelineGroup
  title: string
  label: string
  detail: string | null
  effectiveOn: string | null
  targetType: string
  targetID: string
  amount: string | null
  moneyRole: 'received-gift' | 'gift-adjustment' | 'pledge' | 'recurring-installment' | null
}
export type TimelineCursor = { date: string; id: string; revision: number }
