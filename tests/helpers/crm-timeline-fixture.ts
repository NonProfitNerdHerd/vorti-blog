import { localD1 } from './local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { householdSchemaV1 } from '../../src/crm/household-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { membershipSchemaV1 } from '../../src/crm/membership-schema-v1'
import { opportunitySchemaV1 } from '../../src/crm/opportunity-schema-v1'
import { volunteerSchemaV1 } from '../../src/crm/volunteer-schema-v1'
import { activitySchemaV1 } from '../../src/crm/activity-schema-v1'
import { commentSchemaV1 } from '../../src/crm/comment-schema-v1'
import { crmJobSchemaV1 } from '../../src/crm/job-schema-v1'
import { correspondenceSchemaV1 } from '../../src/crm/correspondence-schema-v1'
import { emailSchemaV1 } from '../../src/crm/email-schema-v1'
import { attachmentSchemaV1 } from '../../src/crm/attachment-schema-v1'
import { timelineIndexesV1 } from '../../src/crm/timeline-indexes-v1'
import { ContactRepository } from '../../src/crm/contacts'

export const crmTimelineSchema = [
  ...organizationSchema,
  ...defaultOrganizationSeed,
  ...contactSchemaV1,
  ...financeSchemaV1,
  ...fundraisingSchemaV1,
  ...householdSchemaV1,
  ...commitmentSchemaV1,
  ...membershipSchemaV1,
  ...opportunitySchemaV1,
  ...volunteerSchemaV1,
  ...activitySchemaV1,
  ...commentSchemaV1,
  ...crmJobSchemaV1,
  ...correspondenceSchemaV1,
  ...emailSchemaV1,
  ...attachmentSchemaV1,
  ...timelineIndexesV1,
] as const

export async function crmTimelineFixture() {
  const fixture = localD1()
  fixture.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT);INSERT INTO users VALUES(1,'administrator','Fictional operator'),(2,'editor','Fictional reader')",
  )
  for (const sql of crmTimelineSchema) fixture.sqlite.exec(sql)
  const contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional timeline donor' },
        roles: ['donor'],
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  return { ...fixture, contact }
}
