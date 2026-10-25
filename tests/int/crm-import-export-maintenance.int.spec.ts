import { expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { importStorage } from '../helpers/crm-import-storage'
import { startImportExport } from '../../src/crm/import-exports'
import { importExportJob } from '../../src/crm/import-export-job'
import { CRMJobs } from '../../src/crm/jobs'
import { cleanImportResults } from '../../src/crm/import-export-maintenance'

async function result(
  fixture: Awaited<ReturnType<typeof crmImportFixture>>,
  bucket: ReturnType<typeof importStorage>,
  steps = 20,
) {
  const id = crypto.randomUUID(),
    now = new Date().toISOString(),
    source = `crm/import-sources/${id}`
  await bucket.storage.put(source, new TextEncoder().encode('Original source'))
  fixture.sqlite
    .prepare(
      `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,headers_json,stage_state,created_at,updated_at)
    VALUES(?,'default',1,'Retention','contacts','Legacy','source.csv','csv',1,?,?,'["Name"]','staging',?,?)`,
    )
    .run(id, 'a'.repeat(64), source, now, now)
  fixture.sqlite
    .prepare('INSERT INTO vc_crm_import_rows(run_id,number,data_json) VALUES(?,2,?)')
    .run(id, '["Fictional retained donor"]')
  fixture.sqlite.prepare("UPDATE vc_crm_import_runs SET stage_state='review' WHERE id=?").run(id)
  const started = await startImportExport(fixture.db, 1, {
    site: 'default',
    id,
    expectedRevision: 1,
    errorsOnly: false,
    operationKey: crypto.randomUUID(),
  })
  const jobs = new CRMJobs(fixture.db),
    handlers = { 'import-apply': importExportJob(fixture.db, bucket.storage) }
  for (let step = 0; step < steps; step++)
    if (!(await jobs.tick(handlers, String(started.job)))) break
  return { id, source, export: String(started.export), job: String(started.job) }
}

it('retains unexpired files, removes expired bytes once, and keeps original source and all financial/source history', async () => {
  const fixture = await crmImportFixture(),
    bucket = importStorage()
  try {
    const file = await result(fixture, bucket),
      size = bucket.objects.size
    const resume = bucket.storage.resumeMultipartUpload.bind(bucket.storage)
    bucket.storage.resumeMultipartUpload = (key, id) => ({
      ...resume(key, id),
      abort: async () => {
        throw Error('Fictional session already completed')
      },
    })
    expect(
      (await cleanImportResults(fixture.db, bucket.storage, Date.now() + 2 * 3600000)).removed,
    ).toBe(0)
    expect(bucket.objects.size).toBe(size)
    const future = Date.now() + 8 * 86400000
    const sweep = await cleanImportResults(fixture.db, bucket.storage, future)
    expect(sweep.removed).toBe(2)
    expect(sweep.uploadFailures).toBe(0)
    expect(bucket.objects.size).toBe(1)
    expect(bucket.objects.has(file.source)).toBe(true)
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_export_files').get()!.n,
    ).toBe(1)
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_rows').get()!.n).toBe(1)
    expect(
      fixture.sqlite.prepare('SELECT data_json FROM vc_crm_import_rows').get()!.data_json,
    ).toBe('["Fictional retained donor"]')
    expect(
      fixture.sqlite
        .prepare(
          'SELECT count(*) AS n FROM vc_crm_import_export_chunks WHERE deleted_at IS NOT NULL',
        )
        .get()!.n,
    ).toBe(1)
    expect((await cleanImportResults(fixture.db, bucket.storage, future)).removed).toBe(0)
  } finally {
    fixture.close()
  }
})

it('fences an expired active assembly before aborting its upload and deleting its chunks', async () => {
  const fixture = await crmImportFixture(),
    bucket = importStorage()
  try {
    const file = await result(fixture, bucket, 2),
      future = Date.now() + 8 * 86400000
    expect(bucket.uploads.size).toBe(1)
    const fence = Number(
      fixture.sqlite.prepare('SELECT fence FROM vc_crm_jobs WHERE id=?').get(file.job)!.fence,
    )
    fixture.sqlite
      .prepare("UPDATE vc_crm_jobs SET status='running',lease_until=? WHERE id=?")
      .run(new Date(future + 3600000).toISOString(), file.job)
    const sweep = await cleanImportResults(fixture.db, bucket.storage, future)
    expect(sweep.uploadsSettled).toBe(1)
    expect(bucket.uploads.size).toBe(0)
    expect(
      fixture.sqlite.prepare('SELECT status,fence FROM vc_crm_jobs WHERE id=?').get(file.job),
    ).toEqual({ status: 'failed', fence: fence + 1 })
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_export_uploads').get()!.n,
    ).toBe(1)
  } finally {
    fixture.close()
  }
})

it('protects active leases and committed chunks, resumes interrupted pages, and reconciles a lost deletion reply', async () => {
  const fixture = await crmImportFixture(),
    bucket = importStorage()
  try {
    const file = await result(fixture, bucket, 1),
      now = Date.now(),
      old = new Date(now - 2 * 3600000)
    const orphan = `crm/import-results/default/${file.export}/${crypto.randomUUID()}.csv`
    await bucket.storage.put(orphan, new Uint8Array([1]))
    for (const value of bucket.objects.values()) value.uploaded = old
    fixture.sqlite
      .prepare("UPDATE vc_crm_jobs SET status='running',lease_until=? WHERE id=?")
      .run(new Date(now + 3600000).toISOString(), file.job)
    expect((await cleanImportResults(fixture.db, bucket.storage, now)).removed).toBe(0)
    fixture.sqlite
      .prepare('UPDATE vc_crm_jobs SET lease_until=? WHERE id=?')
      .run(new Date(now - 1).toISOString(), file.job)
    for (let index = 0; index < 105; index++) {
      const key = `crm/import-results/default/${crypto.randomUUID()}/${crypto.randomUUID()}.csv`
      await bucket.storage.put(key, new Uint8Array([1]))
      bucket.objects.get(key)!.uploaded = old
    }
    const recent = `crm/import-results/default/${crypto.randomUUID()}/recent.csv`
    await bucket.storage.put(recent, new Uint8Array([1]))
    const remove = bucket.storage.delete.bind(bucket.storage)
    let calls = 0
    bucket.storage.delete = async (key) => {
      if (++calls === 1) throw Error('Fictional deletion outage')
      await remove(key)
      if (calls === 2) throw Error('Fictional lost deletion reply')
    }
    await expect(cleanImportResults(fixture.db, bucket.storage, now)).rejects.toThrow('outage')
    let removed = 0,
      pages = 0
    for (; pages < 5; pages++) {
      const sweep = await cleanImportResults(fixture.db, bucket.storage, now)
      removed += sweep.removed
      if (!sweep.more) break
    }
    expect(removed).toBe(106)
    expect(pages).toBeGreaterThan(0)
    expect(bucket.objects.has(recent)).toBe(true)
    expect(bucket.objects.has(file.source)).toBe(true)
    expect(
      fixture.sqlite
        .prepare('SELECT count(*) AS n FROM vc_crm_import_export_chunks WHERE deleted_at IS NULL')
        .get()!.n,
    ).toBe(1)
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) AS n FROM vc_crm_import_export_cleanup WHERE kind='object'")
        .get()!.n,
    ).toBe(106)
  } finally {
    fixture.close()
  }
})
