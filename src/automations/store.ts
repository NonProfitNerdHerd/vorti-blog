import { mask, validateDefinition, type Definition, type StepResult } from './model'
export interface AutomationRow {
  id: string
  site: string
  owner: number
  name: string
  draft: string
  revision: number
  published: string | null
  version: number
  active: number
  shared?: number
  created_at: string
  updated_at: string
}
export interface RunRow {
  id: string
  automation: string
  site: string
  owner: number
  version: number
  definition: string
  event: string
  mode: string
  status: string
  steps: string
  refs: string
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  lease_until: string | null
  cancel_requested: number
}
export interface EventRow {
  id: string
  site: string
  resource: string
  record_id: string
  kind: string
  fields: string
  actor?: string
  created_at: string
}
export class AutomationStore {
  constructor(readonly db: D1Database) {}
  async shared(site: string, search = '') {
    return (
      await this.db
        .prepare(
          'SELECT id,name,owner,version,updated_at FROM vc_automations WHERE site=? AND shared=1 AND published IS NOT NULL AND name LIKE ? ORDER BY updated_at DESC LIMIT 100',
        )
        .bind(site, `%${search.slice(0, 120)}%`)
        .all<Pick<AutomationRow, 'id' | 'name' | 'owner' | 'version' | 'updated_at'>>()
    ).results
  }
  async sharedTemplate(site: string, id: string) {
    const row = await this.db
      .prepare(
        'SELECT name,published FROM vc_automations WHERE site=? AND id=? AND shared=1 AND published IS NOT NULL',
      )
      .bind(site, id)
      .first<{ name: string; published: string }>()
    if (!row) throw Error('Workflow unavailable.')
    return { name: row.name, definition: mask(JSON.parse(row.published)) }
  }
  async share(row: AutomationRow, shared: boolean) {
    if (shared && !row.published) throw Error('Publish your workflow before sharing it.')
    const result = await this.db
      .prepare(
        'UPDATE vc_automations SET shared=?,revision=revision+1,updated_at=? WHERE id=? AND site=? AND owner=? AND revision=?',
      )
      .bind(shared ? 1 : 0, new Date().toISOString(), row.id, row.site, row.owner, row.revision)
      .run()
    if (!result.meta.changes) throw Error('This draft changed. Reload before sharing.')
    return this.get(row.site, row.owner, row.id)
  }
  async get(site: string, owner: number, id: string) {
    const row = await this.db
      .prepare('SELECT * FROM vc_automations WHERE id=? AND site=? AND owner=?')
      .bind(id, site, owner)
      .first<AutomationRow>()
    if (!row) throw Error('Automation unavailable.')
    return row
  }
  async list(site: string, owner: number, search = '') {
    return (
      await this.db
        .prepare(
          `SELECT a.*, (SELECT status FROM vc_automation_runs r WHERE r.automation=a.id ORDER BY created_at DESC,id DESC LIMIT 1) AS latest FROM vc_automations a WHERE site=? AND owner=? AND name LIKE ? ORDER BY updated_at DESC LIMIT 100`,
        )
        .bind(site, owner, `%${search.slice(0, 120)}%`)
        .all<AutomationRow & { latest: string | null }>()
    ).results
  }
  async save(
    site: string,
    owner: number,
    input: { id?: string; revision?: number; name: string; definition: unknown },
  ) {
    const definition = validateDefinition(input.definition),
      name = String(input.name || '').trim()
    if (!name || name.length > 160)
      throw Error('Enter an automation name of at most 160 characters.')
    const now = new Date().toISOString(),
      id = input.id || crypto.randomUUID()
    if (input.id) {
      const result = await this.db
        .prepare(
          'UPDATE vc_automations SET name=?,draft=?,revision=revision+1,updated_at=? WHERE id=? AND site=? AND owner=? AND revision=?',
        )
        .bind(name, JSON.stringify(definition), now, id, site, owner, input.revision ?? -1)
        .run()
      if (!result.meta.changes) throw Error('This draft changed. Reload before saving.')
    } else
      await this.db
        .prepare(
          'INSERT INTO vc_automations(id,site,owner,name,draft,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(id, site, owner, name, JSON.stringify(definition), now, now)
        .run()
    return this.get(site, owner, id)
  }
  async control(row: AutomationRow, action: 'publish' | 'pause') {
    if (action === 'publish') {
      const definition = validateDefinition(JSON.parse(row.draft))
      if (!definition.steps.length) throw Error('Add at least one block before publishing.')
      const time = new Date().toISOString()
      const result = await this.db.batch([
        this.db
          .prepare(
            'UPDATE vc_automations SET published=?,version=version+1,active=1,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
          )
          .bind(JSON.stringify(definition), time, row.id, row.revision),
        this.db
          .prepare(
            'INSERT INTO vc_automation_versions(automation,version,definition,published_at) SELECT id,version,published,? FROM vc_automations WHERE id=? AND changes()=1',
          )
          .bind(time, row.id),
      ])
      if (!result[0].meta.changes) throw Error('This draft changed. Reload before publishing.')
    } else
      await this.db
        .prepare(
          'UPDATE vc_automations SET active=0,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
        )
        .bind(new Date().toISOString(), row.id, row.revision)
        .run()
    return this.get(row.site, row.owner, row.id)
  }
  async enqueue(
    row: AutomationRow,
    mode: 'test' | 'live',
    event: EventRow | { id: string; input: Record<string, unknown> },
    draft = false,
  ) {
    const definition: Definition = JSON.parse(draft ? row.draft : row.published!)
    const id = crypto.randomUUID(),
      steps: StepResult[] = definition.steps.map((s) => ({
        id: s.id,
        name: s.name || s.id,
        status: 'unexecuted',
        attempts: 0,
      }))
    await this.db
      .prepare(
        'INSERT OR IGNORE INTO vc_automation_runs(id,automation,site,owner,version,definition,event,mode,steps,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        row.id,
        row.site,
        row.owner,
        draft ? -row.revision : row.version,
        JSON.stringify(definition),
        JSON.stringify(event),
        mode,
        JSON.stringify(steps),
        new Date().toISOString(),
      )
      .run()
    return id
  }
  async dispatch(limit = 30) {
    const events = (
      await this.db
        .prepare(
          'SELECT * FROM vc_automation_events WHERE dispatched=0 ORDER BY created_at,id LIMIT ?',
        )
        .bind(limit)
        .all<EventRow>()
    ).results
    for (const event of events) {
      // Capture the active version and fan out atomically. Repeated ticks cannot duplicate runs.
      await this.db.batch([
        this.db
          .prepare(
            `INSERT OR IGNORE INTO vc_automation_runs(id,automation,site,owner,version,definition,event,mode,steps,created_at)
          SELECT lower(hex(randomblob(16))),id,site,owner,version,published,?,'live',
          (SELECT json_group_array(json_object('id',json_extract(s.value,'$.id'),'name',json_extract(s.value,'$.name'),'status','unexecuted','attempts',0)) FROM json_each(published,'$.steps') s),?
          FROM vc_automations WHERE site=? AND active=1 AND published IS NOT NULL AND updated_at<=? AND json_extract(published,'$.trigger.kind')=? AND json_extract(published,'$.trigger.resource')=?
          AND (COALESCE(json_extract(published,'$.trigger.recordID'),'')='' OR json_extract(published,'$.trigger.recordID')=?)
          AND (?='created' OR EXISTS(SELECT 1 FROM json_each(?) f WHERE f.value=json_extract(published,'$.trigger.field')))`,
          )
          .bind(
            JSON.stringify(event),
            new Date().toISOString(),
            event.site,
            event.created_at,
            event.kind,
            event.resource,
            event.record_id,
            event.kind,
            event.fields,
          ),
        this.db.prepare('UPDATE vc_automation_events SET dispatched=1 WHERE id=?').bind(event.id),
      ])
    }
    return events.length
  }
  async runs(row: AutomationRow) {
    return (
      await this.db
        .prepare(
          'SELECT id,mode,status,version,created_at,started_at,finished_at FROM vc_automation_runs WHERE automation=? AND site=? AND owner=? ORDER BY created_at DESC,id DESC LIMIT 100',
        )
        .bind(row.id, row.site, row.owner)
        .all()
    ).results
  }
  async run(site: string, owner: number, id: string) {
    const row = await this.db
      .prepare('SELECT * FROM vc_automation_runs WHERE id=? AND site=? AND owner=?')
      .bind(id, site, owner)
      .first<RunRow>()
    if (!row) throw Error('Run unavailable.')
    return row
  }
  async cancel(site: string, owner: number, id: string) {
    await this.db
      .prepare(
        "UPDATE vc_automation_runs SET cancel_requested=1,status=CASE status WHEN 'queued' THEN 'canceled' ELSE status END,finished_at=CASE status WHEN 'queued' THEN ? ELSE finished_at END WHERE id=? AND site=? AND owner=? AND status IN('queued','running')",
      )
      .bind(new Date().toISOString(), id, site, owner)
      .run()
  }
}
