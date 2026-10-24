export const opportunityOutcomes = ['open', 'won', 'lost', 'declined'] as const
export type OpportunityOutcome = (typeof opportunityOutcomes)[number]
export const defaultOpportunityStages: ReadonlyArray<{
  name: string
  outcome: OpportunityOutcome
}> = [
  { name: 'Prospect', outcome: 'open' },
  { name: 'Contacted', outcome: 'open' },
  { name: 'Meeting', outcome: 'open' },
  { name: 'Asked', outcome: 'open' },
  { name: 'Committed', outcome: 'open' },
  { name: 'Received', outcome: 'won' },
  { name: 'Lost', outcome: 'lost' },
  { name: 'Declined', outcome: 'declined' },
]
export interface OpportunityPipeline {
  id: string
  site_id: string
  name: string
  archived: number
  revision: number
}
export interface OpportunityStage {
  id: string
  pipeline_id: string
  name: string
  position: number
  outcome: OpportunityOutcome
  archived: number
  revision: number
}
export interface Opportunity {
  id: string
  site_id: string
  constituent_id: string
  label: string
  name: string
  pipeline_id: string
  stage_id: string
  owner_id: number | null
  expected_minor: string | null
  currency: string
  exponent: number
  campaign_id: string | null
  target_on: string | null
  next_action: string
  next_on: string | null
  notes: string
  archived: number
  revision: number
  created_by: number
  created_at: string
  updated_at: string
}
