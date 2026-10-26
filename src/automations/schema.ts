export const automationSchema = [
  `CREATE TABLE IF NOT EXISTS vc_automations(id TEXT PRIMARY KEY,site TEXT NOT NULL,owner INTEGER NOT NULL,name TEXT NOT NULL,draft TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,published TEXT,version INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 0,shared INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS vc_automations_owner ON vc_automations(site,owner,updated_at)`,
  `CREATE TABLE IF NOT EXISTS vc_automation_versions(automation TEXT NOT NULL REFERENCES vc_automations(id),version INTEGER NOT NULL,definition TEXT NOT NULL,published_at TEXT NOT NULL,PRIMARY KEY(automation,version))`,
  `CREATE TRIGGER IF NOT EXISTS vc_automation_versions_immutable BEFORE UPDATE ON vc_automation_versions BEGIN SELECT RAISE(ABORT,'Published versions are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_automation_versions_retained BEFORE DELETE ON vc_automation_versions BEGIN SELECT RAISE(ABORT,'Published versions are retained'); END`,
  `CREATE TABLE IF NOT EXISTS vc_automation_events(id TEXT PRIMARY KEY,site TEXT NOT NULL,resource TEXT NOT NULL,record_id TEXT NOT NULL,kind TEXT NOT NULL,fields TEXT NOT NULL DEFAULT '[]',actor TEXT,created_at TEXT NOT NULL,dispatched INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS vc_automation_events_pending ON vc_automation_events(dispatched,created_at)`,
  `CREATE TABLE IF NOT EXISTS vc_automation_runs(id TEXT PRIMARY KEY,automation TEXT NOT NULL REFERENCES vc_automations(id),site TEXT NOT NULL,owner INTEGER NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,event TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',steps TEXT NOT NULL,refs TEXT NOT NULL DEFAULT '[]',error TEXT,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,lease_until TEXT,cancel_requested INTEGER NOT NULL DEFAULT 0,UNIQUE(automation,event))`,
  `CREATE INDEX IF NOT EXISTS vc_automation_runs_pending ON vc_automation_runs(status,created_at)`,
  `CREATE TRIGGER IF NOT EXISTS vc_automation_run_snapshot BEFORE UPDATE OF automation,site,owner,version,definition,event,mode,created_at ON vc_automation_runs BEGIN SELECT RAISE(ABORT,'Automation run snapshots are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_automation_run_terminal BEFORE UPDATE ON vc_automation_runs WHEN OLD.status IN('succeeded','failed','canceled') BEGIN SELECT RAISE(ABORT,'Completed automation history is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_automation_event_fanout AFTER INSERT ON vc_automation_events BEGIN
    INSERT OR IGNORE INTO vc_automation_runs(id,automation,site,owner,version,definition,event,mode,steps,created_at)
    SELECT lower(hex(randomblob(16))),id,site,owner,version,published,
      json_object('id',NEW.id,'site',NEW.site,'resource',NEW.resource,'record_id',NEW.record_id,'kind',NEW.kind,'fields',NEW.fields,'actor',NEW.actor,'created_at',NEW.created_at),'live',
      (SELECT json_group_array(json_object('id',json_extract(s.value,'$.id'),'name',json_extract(s.value,'$.name'),'status','unexecuted','attempts',0)) FROM json_each(published,'$.steps') s),NEW.created_at
    FROM vc_automations WHERE active=1 AND site=NEW.site AND published IS NOT NULL
      AND json_extract(published,'$.trigger.kind')=NEW.kind AND json_extract(published,'$.trigger.resource')=NEW.resource
      AND (COALESCE(json_extract(published,'$.trigger.recordID'),'')='' OR json_extract(published,'$.trigger.recordID')=NEW.record_id)
      AND (NEW.kind='created' OR EXISTS(SELECT 1 FROM json_each(NEW.fields) f WHERE f.value=json_extract(published,'$.trigger.field')));
    UPDATE vc_automation_events SET dispatched=1 WHERE id=NEW.id;
  END`,
]

/** Installed by migration, so event enqueue participates in the resource's own transaction.
 * Record values stay in the source; workers must load them through current authorization.
 * Automation writes carry a server-owned origin marker: this release does not chain workflows.
 */
export const nativeAutomationSources = [
  {
    table: 'form_submissions',
    resource: 'form-submissions',
    site: 'site',
    fields: ['workflow_status'],
    origin: false,
  },
  {
    table: 'review_tasks',
    resource: 'review-tasks',
    site: 'automation_site',
    fields: ['status', 'assignee_id', 'priority', 'due_date', 'title'],
    origin: true,
  },
  {
    table: 'pages',
    resource: 'pages',
    site: 'platform_site',
    fields: ['title', '_status'],
    origin: true,
  },
  {
    table: 'posts',
    resource: 'posts',
    site: 'platform_site',
    fields: ['title', '_status'],
    origin: true,
  },
] as const
export function sourceTriggers(source: (typeof nativeAutomationSources)[number]): string[] {
  const { table, resource, site, origin } = source
  const predicate = origin ? 'NEW.automation_origin IS NULL' : '1=1'
  const actor =
    table === 'pages' || table === 'posts'
      ? 'NEW.platform_write_actor'
      : "json_extract(NEW.platform_mutation_proof,'$.actor')"
  const insert = (kind: string, fields: string) =>
    `INSERT INTO vc_automation_events(id,site,resource,record_id,kind,fields,actor,created_at) VALUES(lower(hex(randomblob(16))),COALESCE(NEW.${site},'default'),'${resource}',CAST(NEW.id AS TEXT),'${kind}',${fields},CAST(${actor} AS TEXT),strftime('%Y-%m-%dT%H:%M:%fZ','now'));`
  return [
    `CREATE TRIGGER IF NOT EXISTS vc_automation_${table}_created AFTER INSERT ON ${table} WHEN ${predicate} BEGIN ${insert('created', "'[]'")} END`,
    `CREATE TRIGGER IF NOT EXISTS vc_automation_${table}_updated AFTER UPDATE ON ${table} WHEN (${predicate}) AND (${source.fields.map((f) => `OLD.${f} IS NOT NEW.${f}`).join(' OR ')}) BEGIN ${insert('updated', `(SELECT json_group_array(value) FROM (${source.fields.map((f) => `SELECT '${({ workflow_status: 'workflowStatus', assignee_id: 'assignee', due_date: 'dueDate' } as Record<string, string>)[f] || f}' AS value WHERE OLD.${f} IS NOT NEW.${f}`).join(' UNION ALL ')}))`)} END`,
  ]
}
export const contactAutomationTrigger = `CREATE TRIGGER IF NOT EXISTS vc_automation_contact_audit AFTER INSERT ON vc_platform_audit WHEN NEW.record_type='constituent' AND NEW.action IN('contact.created','contact.profile.updated') AND NEW.operation_key NOT LIKE 'automation-%' BEGIN INSERT INTO vc_automation_events(id,site,resource,record_id,kind,fields,actor,created_at) VALUES(NEW.id,NEW.site_id,'contacts',NEW.record_id,CASE NEW.action WHEN 'contact.created' THEN 'created' ELSE 'updated' END,'["profile"]',CAST(NEW.actor_id AS TEXT),NEW.created_at); END`
