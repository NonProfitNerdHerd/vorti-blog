export const crmJobSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_jobs (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id), actor_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK(kind IN('report-export','import-apply','contact-merge','correspondence')),
    payload TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '', progress INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','completed','failed','cancelled')),
    fence INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
    lease_until TEXT, error TEXT, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_jobs_pending_idx ON vc_crm_jobs(status,next_attempt_at,lease_until,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_jobs_actor_idx ON vc_crm_jobs(site_id,actor_id,created_at,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_job_ownership BEFORE UPDATE OF site_id,actor_id,kind,payload ON vc_crm_jobs
    BEGIN SELECT RAISE(ABORT,'Job request context is immutable'); END`,
] as const
