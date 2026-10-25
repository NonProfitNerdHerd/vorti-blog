import { crmTimelineFixture } from './crm-timeline-fixture'
import { applyImportSchemaV1 } from '../../src/crm/import-schema-v1'
export async function crmImportFixture(
  beforeUpgrade?: (fixture: Awaited<ReturnType<typeof crmTimelineFixture>>) => void | Promise<void>,
) {
  const fixture = await crmTimelineFixture()
  await beforeUpgrade?.(fixture)
  await applyImportSchemaV1(
    async (sql) => fixture.sqlite.exec(sql),
    async () =>
      fixture.sqlite.prepare('PRAGMA table_info(vc_crm_source_identifiers)').all() as Array<{
        name: string
      }>,
  )
  return fixture
}
