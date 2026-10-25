/** Additive lookup support for chapter/typed-record audit history. */
export const timelineIndexesV1 = [
  'CREATE INDEX IF NOT EXISTS vc_platform_audit_record_idx ON vc_platform_audit(site_id,record_type,record_id,created_at,id)',
] as const
