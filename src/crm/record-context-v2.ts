import { crmRecordRulesV1 } from './record-context-v1'
/** New task-capable fundraising records; v1 migration SQL remains frozen. */
export const crmRecordRulesV2 = {
  ...crmRecordRulesV1,
  campaign: { category: 'finances' as const, sql: 'SELECT id,name AS label,revision FROM vc_crm_campaigns WHERE site_id=? AND id=?' },
  appeal: { category: 'finances' as const, sql: 'SELECT id,name AS label,revision FROM vc_crm_appeals WHERE site_id=? AND id=?' },
}
