import { expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { importStorage } from '../helpers/crm-import-storage'
import { startImportExport } from '../../src/crm/import-exports'
import { importExportJob } from '../../src/crm/import-export-job'
import { importResultsCSV } from '../../src/crm/import-results'
import { CRMJobs } from '../../src/crm/jobs'
import { assertImportExportReadable } from '../../src/crm/import-export-access'
import { ImportReviewRepository } from '../../src/crm/import-review'
import { importExportDownload } from '../../src/crm/import-export-download'
import { controlImportExport, listImportExports } from '../../src/crm/import-export-controls'

async function staged(
  fixture: Awaited<ReturnType<typeof crmImportFixture>>,
  count = 57,
  padding = '',
) {
  const id = crypto.randomUUID(),
    now = new Date().toISOString()
  fixture.sqlite
    .prepare(
      `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,headers_json,stage_state,created_at,updated_at)
    VALUES(?,'default',1,'Result file','contacts','Legacy','source.csv','csv',1,?,?,'["Name","Amount"]','staging',?,?)`,
    )
    .run(id, 'a'.repeat(64), crypto.randomUUID(), now, now)
  for (let index = 0; index < count; index++)
    fixture.sqlite
      .prepare('INSERT INTO vc_crm_import_rows(run_id,number,data_json) VALUES(?,?,?)')
      .run(id, index + 2, JSON.stringify([`Person ${index}`, '900719925474099.31' + padding]))
  fixture.sqlite.prepare("UPDATE vc_crm_import_runs SET stage_state='review' WHERE id=?").run(id)
  return id
}
it('resumes private result generation after cancellation and matches every foreground result byte without duplicate chunks', async () => {
  const fixture = await crmImportFixture(),
    bucket = importStorage()
  try {
    const id = await staged(fixture),
      input = {
        site: 'default',
        id,
        expectedRevision: 1,
        errorsOnly: false,
        operationKey: crypto.randomUUID(),
      },
      started = await startImportExport(fixture.db, 1, input),
      jobs = new CRMJobs(fixture.db),
      handlers = { 'import-apply': importExportJob(fixture.db, bucket.storage) },
      job = String(started.job)
    expect(await startImportExport(fixture.db, 1, input)).toEqual(started)
    await jobs.tick(handlers, job)
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_export_chunks').get()!.n,
    ).toBe(1)
    let fence = Number(
      fixture.sqlite.prepare('SELECT fence FROM vc_crm_jobs WHERE id=?').get(job)!.fence,
    )
    await controlImportExport(fixture.db, 1, {
      site: 'default',
      id,
      export: String(started.export),
      expectedRevision: 1,
      expectedFence: fence,
      operationKey: crypto.randomUUID(),
      action: 'cancel-results',
    })
    expect(await jobs.tick(handlers, job)).toBe(false)
    fence = Number(
      fixture.sqlite.prepare('SELECT fence FROM vc_crm_jobs WHERE id=?').get(job)!.fence,
    )
    await controlImportExport(fixture.db, 1, {
      site: 'default',
      id,
      export: String(started.export),
      expectedRevision: 1,
      expectedFence: fence,
      operationKey: crypto.randomUUID(),
      action: 'retry-results',
    })
    for (let step = 0; step < 20; step++) if (!(await jobs.tick(handlers, job))) break
    expect(
      fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(job)!.status,
      JSON.stringify(
        fixture.sqlite.prepare('SELECT cursor,error FROM vc_crm_jobs WHERE id=?').get(job),
      ),
    ).toBe('completed')
    const chunks = fixture.sqlite
      .prepare(
        'SELECT ordinal,object_key,rows FROM vc_crm_import_export_chunks WHERE export_id=? ORDER BY ordinal',
      )
      .all(String(started.export))
    expect(chunks.reduce((sum, chunk) => sum + Number(chunk.rows), 0)).toBe(57)
    const bytes = Buffer.concat(
        chunks.map((chunk) => Buffer.from(bucket.objects.get(String(chunk.object_key))!.bytes)),
      ),
      foreground = await importResultsCSV(fixture.db, 1, 'default', id)
    expect(bytes.equals(Buffer.from(await foreground.arrayBuffer()))).toBe(true)
    const published = fixture.sqlite
      .prepare('SELECT object_key,bytes FROM vc_crm_import_export_files WHERE export_id=?')
      .get(String(started.export))!
    expect(Buffer.from(bucket.objects.get(String(published.object_key))!.bytes)).toEqual(bytes)
    expect(Number(published.bytes)).toBe(bytes.length)
    let storageReads = 0
    const counted = {
      get: async (...args: Parameters<R2Bucket['get']>) => {
        storageReads++
        return bucket.storage.get(...args)
      },
    } as R2Bucket
    const download = await importExportDownload(
      fixture.db,
      counted,
      1,
      'default',
      id,
      String(started.export),
    )
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes)
    expect(storageReads).toBe(1)
    expect(download.headers.get('cache-control')).toBe('private, no-store')
    expect(download.headers.get('x-import-matching-rows')).toBe('57')
    await expect(
      importExportDownload(fixture.db, counted, 2, 'default', id, String(started.export)),
    ).rejects.toThrow()
    await expect(
      importExportDownload(
        fixture.db,
        counted,
        1,
        'default',
        'another-run',
        String(started.export),
      ),
    ).rejects.toThrow()
    expect(storageReads).toBe(1)
    expect(bucket.uploads.size).toBe(0)
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
    let rowQueries = 0
    const tracked = {
      ...fixture.db,
      prepare: (sql: string) => {
        if (sql.includes('vc_crm_import_rows')) rowQueries++
        return fixture.db.prepare(sql)
      },
    } as D1Database
    await assertImportExportReadable(tracked, 1, 'default', String(started.export))
    expect(rowQueries).toBe(1)
    await expect(
      assertImportExportReadable(fixture.db, 2, 'default', String(started.export)),
    ).rejects.toThrow()
    expect(await jobs.tick(handlers, job)).toBe(false)
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_export_chunks').get()!.n,
    ).toBe(chunks.length)
  } finally {
    fixture.close()
  }
})

it('paginates every private result file and permits stopping expired work while rejecting stale retries', async () => {
  const fixture = await crmImportFixture()
  try {
    const id = await staged(fixture),
      ids: string[] = []
    let expiredJob = ''
    for (let index = 0; index < 27; index++) {
      const created = await startImportExport(
        fixture.db,
        1,
        {
          site: 'default',
          id,
          expectedRevision: 1,
          errorsOnly: false,
          operationKey: crypto.randomUUID(),
        },
        index === 26 ? Date.now() - 8 * 86400000 : Date.now(),
      )
      ids.push(String(created.export))
      if (index === 26) expiredJob = String(created.job)
    }
    const first = await listImportExports(fixture.db, 1, 'default', id)
    expect(first.docs).toHaveLength(25)
    const second = await listImportExports(fixture.db, 1, 'default', id, first.next!)
    expect(second.docs).toHaveLength(2)
    expect(second.next).toBeNull()
    expect(new Set([...first.docs, ...second.docs].map((file) => file.id)).size).toBe(27)
    expect(JSON.stringify(first)).not.toMatch(/object_key|upload_id|payload|cursor/)
    await expect(listImportExports(fixture.db, 2, 'default', id)).rejects.toThrow()
    const control = {
      site: 'default',
      id,
      export: ids[26],
      expectedRevision: 1,
      expectedFence: 0,
      operationKey: crypto.randomUUID(),
      action: 'cancel-results' as const,
    }
    await expect(
      controlImportExport(fixture.db, 1, { ...control, expectedFence: 99 }),
    ).rejects.toThrow()
    await controlImportExport(fixture.db, 1, control)
    expect(
      fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(expiredJob)!.status,
    ).toBe('cancelled')
    await expect(
      controlImportExport(fixture.db, 1, {
        ...control,
        expectedFence: 1,
        operationKey: crypto.randomUUID(),
        action: 'retry-results',
      }),
    ).rejects.toThrow('expired')
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
  } finally {
    fixture.close()
  }
})

it.each(['part', 'complete', 'cancel'] as const)(
  'resumes assembly after %s interruption and publishes one complete private file',
  async (interruption) => {
    const fixture = await crmImportFixture(),
      bucket = importStorage()
    try {
      const id = await staged(fixture, 140)
      const started = await startImportExport(fixture.db, 1, {
        site: 'default',
        id,
        expectedRevision: 1,
        errorsOnly: false,
        operationKey: crypto.randomUUID(),
      })
      const job = String(started.job)
      let now = Date.now(),
        interrupted = false
      const jobs = new CRMJobs(fixture.db, () => now),
        handlers = { 'import-apply': importExportJob(fixture.db, bucket.storage) }
      if (interruption === 'part') bucket.loseNextPartReply()
      if (interruption === 'complete') bucket.loseNextCompleteReply()
      for (let step = 0; step < 40; step++) {
        const state = fixture.sqlite
          .prepare('SELECT status,cursor,fence FROM vc_crm_jobs WHERE id=?')
          .get(job)!
        if (state.status === 'completed') break
        const cursor = JSON.parse(String(state.cursor) || '{}')
        if (interruption === 'cancel' && cursor.initialized && !interrupted) {
          await jobs.cancel(1, 'default', job, crypto.randomUUID(), Number(state.fence))
          expect(bucket.uploads.size).toBe(1)
          expect(await jobs.tick(handlers, job)).toBe(false)
          await jobs.retry(
            1,
            'default',
            job,
            Number(
              fixture.sqlite.prepare('SELECT fence FROM vc_crm_jobs WHERE id=?').get(job)!.fence,
            ),
            crypto.randomUUID(),
          )
          interrupted = true
        }
        now += 60000
        await jobs.tick(handlers, job)
      }
      expect(
        fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(job)!.status,
      ).toBe('completed')
      const files = fixture.sqlite
        .prepare('SELECT * FROM vc_crm_import_export_files WHERE export_id=?')
        .all(String(started.export))
      expect(files).toHaveLength(1)
      const foreground = await importResultsCSV(fixture.db, 1, 'default', id)
      expect(Buffer.from(bucket.objects.get(String(files[0].object_key))!.bytes)).toEqual(
        Buffer.from(await foreground.arrayBuffer()),
      )
      expect(
        fixture.sqlite
          .prepare(
            'SELECT count(*) AS n FROM vc_crm_import_export_steps WHERE part_number IS NOT NULL',
          )
          .get()!.n,
      ).toBe(1)
      expect(
        Number(
          fixture.sqlite
            .prepare(
              'SELECT count(*) AS n FROM vc_crm_import_export_steps WHERE object_key IS NOT NULL',
            )
            .get()!.n,
        ),
      ).toBeGreaterThan(0)
      expect(bucket.uploads.size).toBe(0)
      expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(
        1,
      )
    } finally {
      fixture.close()
    }
  },
)

it('assembles multiple fixed-size multipart pieces and downloads every byte of a large result', async () => {
  const fixture = await crmImportFixture(),
    bucket = importStorage()
  try {
    const id = await staged(fixture, 600, 'x'.repeat(32700))
    const started = await startImportExport(fixture.db, 1, {
      site: 'default',
      id,
      expectedRevision: 1,
      errorsOnly: false,
      operationKey: crypto.randomUUID(),
    })
    const job = String(started.job),
      jobs = new CRMJobs(fixture.db),
      handlers = { 'import-apply': importExportJob(fixture.db, bucket.storage) }
    for (let step = 0; step < 150; step++) if (!(await jobs.tick(handlers, job))) break
    expect(
      fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(job)!.status,
    ).toBe('completed')
    const parts = fixture.sqlite
      .prepare(
        'SELECT bytes FROM vc_crm_import_export_steps WHERE part_number IS NOT NULL ORDER BY part_number',
      )
      .all()
    expect(parts).toHaveLength(3)
    expect(parts.slice(0, -1).map((part) => part.bytes)).toEqual([8 * 1024 * 1024, 8 * 1024 * 1024])
    const download = await importExportDownload(
      fixture.db,
      bucket.storage,
      1,
      'default',
      id,
      String(started.export),
    )
    const foreground = await importResultsCSV(fixture.db, 1, 'default', id)
    // Native byte comparison avoids enumerating millions of typed-array properties.
    expect(
      Buffer.from(await download.arrayBuffer()).equals(Buffer.from(await foreground.arrayBuffer())),
    ).toBe(true)
    expect(download.headers.get('x-import-matching-rows')).toBe('600')
  } finally {
    fixture.close()
  }
}, 60000)

it('denies generated result access after a referenced constituent becomes private, with its source history retained', async () => {
  const fixture = await crmImportFixture(),
    bucket = importStorage()
  try {
    const id = await staged(fixture),
      reviews = new ImportReviewRepository(fixture.db, 1)
    await reviews.mapping({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey: crypto.randomUUID(),
      mapping: {
        version: 1,
        domain: 'contacts',
        headers: ['Name', 'Amount'],
        columns: [{ field: 'firstName', column: 0, clearBlank: false, referenceMode: 'record' }],
      },
    })
    for (let number = 2; number < 59; number++)
      await reviews.review({
        site: 'default',
        id,
        expectedRevision: 2,
        number,
        rowRevision: 1,
        decision: 'keep',
        target: fixture.contact,
        operationKey: crypto.randomUUID(),
      })
    const started = await startImportExport(fixture.db, 1, {
        site: 'default',
        id,
        expectedRevision: 2,
        errorsOnly: false,
        operationKey: crypto.randomUUID(),
      }),
      jobs = new CRMJobs(fixture.db),
      handlers = { 'import-apply': importExportJob(fixture.db, bucket.storage) }
    for (let count = 0; count < 20; count++)
      if (!(await jobs.tick(handlers, String(started.job)))) break
    expect(
      fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(String(started.job))!
        .status,
    ).toBe('completed')
    await assertImportExportReadable(fixture.db, 1, 'default', String(started.export))
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(fixture.contact)
    await expect(
      assertImportExportReadable(fixture.db, 1, 'default', String(started.export)),
    ).rejects.toThrow()
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_rows WHERE run_id=?').get(id)!
        .n,
    ).toBe(57)
  } finally {
    fixture.close()
  }
})

it('removes uncommitted bytes after a lost storage acknowledgement and refuses changed source snapshots', async () => {
  const fixture = await crmImportFixture(),
    bucket = importStorage()
  try {
    const id = await staged(fixture),
      started = await startImportExport(fixture.db, 1, {
        site: 'default',
        id,
        expectedRevision: 1,
        errorsOnly: false,
        operationKey: crypto.randomUUID(),
      }),
      job = String(started.job)
    let clock = Date.now()
    const jobs = new CRMJobs(fixture.db, () => clock),
      handlers = { 'import-apply': importExportJob(fixture.db, bucket.storage) }
    bucket.loseNextReply()
    await jobs.tick(handlers, job)
    expect(bucket.objects.size).toBe(0)
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_export_chunks').get()!.n,
    ).toBe(0)
    clock += 10000
    await jobs.tick(handlers, job)
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_export_chunks').get()!.n,
    ).toBe(1)
    fixture.sqlite.prepare('UPDATE vc_crm_import_runs SET revision=revision+1 WHERE id=?').run(id)
    clock += 10000
    for (let step = 0; step < 6; step++) {
      await jobs.tick(handlers, job)
      clock += 100000
    }
    expect(
      fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(job)!.status,
    ).toBe('failed')
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_export_chunks').get()!.n,
    ).toBe(1)
  } finally {
    fixture.close()
  }
})
