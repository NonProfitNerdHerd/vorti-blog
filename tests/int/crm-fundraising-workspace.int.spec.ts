import { expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { fundraisingSchemaV2 } from '../../src/crm/fundraising-schema-v2'
import { campaignBoardSchemaV1 } from '../../src/crm/campaign-board-schema-v1'
import { FundraisingRepository } from '../../src/crm/fundraising'
import { FundraisingReport } from '../../src/crm/fundraising-report'
import { FinanceRepository } from '../../src/crm/finance'
import { ContactRepository } from '../../src/crm/contacts'
import { CRMRecordAccess } from '../../src/crm/record-access'

it('links shared funds, snapshots eligible recipients, and reports net attributed gifts without multiplying them', async () => {
  const fixture = await crmTimelineFixture()
  const key = () => crypto.randomUUID()
  try {
    for (const statement of fundraisingSchemaV2) fixture.sqlite.exec(statement)
    const fundraising = new FundraisingRepository(fixture.db, 1)
    const finance = new FinanceRepository(fixture.db, 1)
    const contacts = new ContactRepository(fixture.db, 1)
    const eligible = String((await contacts.create({ site: 'default', profile: { kind: 'person', firstName: 'Eligible', methods: [{ kind: 'email', value: 'eligible@example.test', primary: true, label: '' }] }, roles: ['donor'], operationKey: key() })).id)
    const excluded = String((await contacts.create({ site: 'default', profile: { kind: 'person', firstName: 'Excluded', doNotContact: true, methods: [{ kind: 'email', value: 'excluded@example.test', primary: true, label: '' }] }, roles: ['donor'], operationKey: key() })).id)
    const fund = String((await fundraising.save({ site: 'default', kind: 'funds', operationKey: key(), values: { name: 'Shared fund', internalCode: 'SHARED' } })).id)
    const campaign = String((await fundraising.save({ site: 'default', kind: 'campaigns', operationKey: key(), values: { name: 'Campaign A', fundIds: [fund], currency: 'USD', exponent: 2, goalMinor: '10000' } })).id)
    const other = String((await fundraising.save({ site: 'default', kind: 'campaigns', operationKey: key(), values: { name: 'Campaign B', fundIds: [fund] } })).id)
    const appeal = String((await fundraising.save({ site: 'default', kind: 'appeals', operationKey: key(), values: { name: 'Autumn appeal', campaignId: campaign, defaultFundId: fund, channel: 'email', status: 'draft', recipientIds: [eligible, excluded] } })).id)
    expect((await new CRMRecordAccess(fixture.db, 1).resolve('default', { type: 'campaign', id: campaign })).record.label).toBe('Campaign A')
    expect((await new CRMRecordAccess(fixture.db, 1).resolve('default', { type: 'appeal', id: appeal })).record.label).toBe('Autumn appeal')
    const gift = await finance.createGift({ site: 'default', constituent: fixture.contact, amount: { currency: 'USD', minorUnits: '10000' }, exponent: 2, kind: 'cash', receivedOn: '2026-10-31', allocations: [{ fund, currency: 'USD', minorUnits: '10000' }], campaign, appeal, operationKey: key() })
    const report = await new FundraisingReport(fixture.db, 1).load('default')
    expect(report.totals).toEqual([{ currency: 'USD', exponent: 2, minor: '10000' }])
    expect(report.campaigns.find(row => row.id === campaign)?.received).toEqual(report.totals)
    expect(report.campaigns.find(row => row.id === other)?.received).toEqual([])
    expect(report.funds.find(row => row.id === fund)?.received).toEqual(report.totals)
    expect(report.funds.find(row => row.id === fund)?.campaignCount).toBe(2)
    expect(report.appeals.find(row => row.id === appeal)?.audience).toMatchObject({ selected: 2, eligible: 1 })
    expect(report.recipients.find(row => row.constituent_id === excluded)?.exclusion).toBe('Do not contact')
    expect((await new FundraisingReport(fixture.db, 1).candidates('default', 'Elig')).docs.some(row => row.id === eligible)).toBe(true)
    expect((await new FundraisingReport(fixture.db, 1).previewAudience('default', appeal)).changes).toEqual([])
    await fundraising.recordOutreach({ site: 'default', appeal, expectedRevision: 1, notes: 'Mail merge sent through existing correspondence process', occurredAt: '2026-10-31T12:00:00.000Z', operationKey: key() })
    expect((await new FundraisingReport(fixture.db, 1).load('default')).outreach).toHaveLength(1)
    await expect(fundraising.save({ site: 'default', kind: 'appeals', id: appeal, expectedRevision: 2, operationKey: key(), values: { name: 'Autumn appeal', campaignId: campaign, status: 'draft', recipientIds: [eligible] } })).rejects.toThrow('cannot return to draft')
    await finance.adjust({ site: 'default', id: String(gift.id), expectedRevision: 1, action: 'refund', deltaMinor: '-2500', reason: 'Partial refund', operationKey: key() })
    const after = await new FundraisingReport(fixture.db, 1).load('default')
    expect(after.totals[0].minor).toBe('7500')
    expect(after.funds.find(row => row.id === fund)?.received[0].minor).toBe('7500')
  } finally { fixture.close() }
})

it('deletes unused fundraising records and blocks operational references and stale confirmations', async () => {
  const fixture = await crmTimelineFixture()
  const key = () => crypto.randomUUID()
  try {
    for (const statement of fundraisingSchemaV2) fixture.sqlite.exec(statement)
    fixture.sqlite.exec('CREATE TABLE review_tasks(id INTEGER PRIMARY KEY,crm_site TEXT,crm_type TEXT,crm_i_d TEXT)')
    fixture.sqlite.exec('CREATE TABLE task_boards(id INTEGER PRIMARY KEY,platform_site TEXT,archived INTEGER NOT NULL DEFAULT 0)')
    for (const statement of campaignBoardSchemaV1) fixture.sqlite.exec(statement)
    const fundraising = new FundraisingRepository(fixture.db, 1)
    const fund = String((await fundraising.save({ site: 'default', kind: 'funds', operationKey: key(), values: { name: 'Unused fund' } })).id)
    const preview = await fundraising.deletionPreview('default', 'funds', fund)
    expect(preview.blockers).toEqual([])
    await expect(fundraising.delete({ site: 'default', kind: 'funds', id: fund, expectedRevision: preview.revision, confirmation: 'Delete wrong name', operationKey: key() })).rejects.toThrow()
    await fundraising.delete({ site: 'default', kind: 'funds', id: fund, expectedRevision: preview.revision, confirmation: 'Delete Unused fund', operationKey: key() })
    await expect(fundraising.get('default', 'funds', fund)).rejects.toThrow()

    const linkedFund = String((await fundraising.save({ site: 'default', kind: 'funds', operationKey: key(), values: { name: 'Linked fund' } })).id)
    const campaign = String((await fundraising.save({ site: 'default', kind: 'campaigns', operationKey: key(), values: { name: 'Linked campaign', fundIds: [linkedFund] } })).id)
    await fundraising.save({ site: 'default', kind: 'funds', id: linkedFund, expectedRevision: 1, operationKey: key(), values: { name: 'Linked fund', archived: true } })
    await fundraising.save({ site: 'default', kind: 'campaigns', id: campaign, expectedRevision: 1, operationKey: key(), values: { name: 'Linked campaign', fundIds: [linkedFund] } })
    expect((await fundraising.deletionPreview('default', 'funds', linkedFund)).blockers).toContain('linked campaigns')
    expect((await fundraising.deletionPreview('default', 'campaigns', campaign)).blockers).toContain('linked funds')
    await expect(fundraising.delete({ site: 'default', kind: 'funds', id: linkedFund, expectedRevision: 2, confirmation: 'Delete Linked fund', operationKey: key() })).rejects.toThrow('linked campaigns')

    const appeal = String((await fundraising.save({ site: 'default', kind: 'appeals', operationKey: key(), values: { name: 'Draft appeal', campaignId: campaign, recipientIds: [fixture.contact] } })).id)
    expect((await fundraising.deletionPreview('default', 'appeals', appeal)).blockers).toContain('saved recipient snapshots')
    expect((await fundraising.deletionPreview('default', 'campaigns', campaign)).blockers).toContain('appeals')
    fixture.sqlite.exec(`INSERT INTO review_tasks(id,crm_site,crm_type,crm_i_d) VALUES(1,'default','campaign','${campaign}')`)
    expect((await fundraising.deletionPreview('default', 'campaigns', campaign)).blockers).toContain('VortiTasks tasks')

    const boardCampaign = String((await fundraising.save({ site: 'default', kind: 'campaigns', operationKey: key(), values: { name: 'Board campaign' } })).id)
    fixture.sqlite.exec("INSERT INTO task_boards(id,platform_site) VALUES(10,'default'),(11,'another-site')")
    expect(() => fixture.sqlite.exec(`INSERT INTO vc_crm_campaign_boards(campaign_id,site_id,board_id,created_at) VALUES('${boardCampaign}','default',11,'2026-10-31')`)).toThrow()
    fixture.sqlite.exec(`INSERT INTO vc_crm_campaign_boards(campaign_id,site_id,board_id,created_at) VALUES('${boardCampaign}','default',10,'2026-10-31')`)
    expect((await fundraising.deletionPreview('default', 'campaigns', boardCampaign)).blockers).toContain('a linked VortiTasks board')
    fixture.sqlite.exec(`DELETE FROM vc_crm_campaign_boards WHERE campaign_id='${boardCampaign}'`)
    await fundraising.delete({ site: 'default', kind: 'campaigns', id: boardCampaign, expectedRevision: 1, confirmation: 'Delete Board campaign', operationKey: key() })

    const fresh = String((await fundraising.save({ site: 'default', kind: 'campaigns', operationKey: key(), values: { name: 'Original' } })).id)
    const emptyAppeal = String((await fundraising.save({ site: 'default', kind: 'appeals', operationKey: key(), values: { name: 'Empty appeal', campaignId: fresh, recipientIds: [] } })).id)
    expect((await fundraising.deletionPreview('default', 'appeals', emptyAppeal)).blockers).toEqual([])
    await fundraising.delete({ site: 'default', kind: 'appeals', id: emptyAppeal, expectedRevision: 1, confirmation: 'Delete Empty appeal', operationKey: key() })
    const stale = await fundraising.deletionPreview('default', 'campaigns', fresh)
    await fundraising.save({ site: 'default', kind: 'campaigns', id: fresh, expectedRevision: stale.revision, operationKey: key(), values: { name: 'Renamed' } })
    await expect(fundraising.delete({ site: 'default', kind: 'campaigns', id: fresh, expectedRevision: stale.revision, confirmation: 'Delete Original', operationKey: key() })).rejects.toThrow()
    const current = await fundraising.deletionPreview('default', 'campaigns', fresh)
    await fundraising.delete({ site: 'default', kind: 'campaigns', id: fresh, expectedRevision: current.revision, confirmation: 'Delete Renamed', operationKey: key() })
  } finally { fixture.close() }
})
