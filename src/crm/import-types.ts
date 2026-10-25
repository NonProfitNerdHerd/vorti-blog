import type { ImportDomain } from './import-model'
import type { ImportDecision } from './import-domain-plan'
export interface ImportRun {
  id: string
  site_id: string
  actor_id: number
  name: string
  domain: ImportDomain
  source_system: string
  file_name: string
  file_kind: 'csv' | 'xlsx'
  file_size: number
  file_sha256: string
  file_key: string
  file_uploaded_at: string | null
  header_row: number
  sheet_name: string
  delimiter: ',' | ';' | '\t'
  headers_json: string
  mapping_json: string | null
  config_revision: number
  revision: number
  stage_state: 'uploading' | 'ready' | 'staging' | 'review' | 'failed'
  stage_cursor: string
  stage_error: string | null
  status: 'draft' | 'approved'
  financial: number
  allow_new_unidentified: number
  job_id: string | null
  approved_authority_revision: number | null
  created_at: string
  updated_at: string
}
export interface ImportRow {
  run_id: string
  number: number
  data_json: string
  parse_issues: string
  revision: number
  decision: ImportDecision | null
  target_id: string | null
  source_id: string | null
  review_json: string | null
  review_hash: string | null
  review_config_revision: number | null
  review_authority_revision: number | null
  validated_revision: number | null
  applied_id: string | null
  applied_action: 'created' | 'updated' | 'kept' | 'skipped' | null
  applied_at: string | null
}
