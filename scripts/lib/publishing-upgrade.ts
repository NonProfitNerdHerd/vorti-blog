import { convertLegacyIntranet } from '../../src/publishing/legacy-conversion'
import { seedPublishingPortals } from '../../src/publishing/portal-seed'

export async function verifyPublishingUpgradeInputs(database: D1Database) {
  const unified = await database.prepare("SELECT 1 FROM payload_migrations WHERE name='20261028_000000_unified_publishing'").first()
  // Earlier plugin files have no reliable stored owner/source manifest. Do not
  // silently strand them or invent provenance while changing their delivery.
  // This installation is inventoried again immediately before its migration.
  if (!unified) {
    const pending = await database.prepare('SELECT (SELECT COUNT(*) FROM imports)+(SELECT COUNT(*) FROM exports) n').first<{ n: number }>()
    if (pending?.n) throw Error('Retained legacy import/export records require a verified file/provenance conversion before this upgrade. No records were changed.')
  }
  return { legacyPipelineRecords: unified ? null : 0, verifiedAt: new Date().toISOString() }
}

/** Called only inside the guarded, stopped-write upgrade after schema migration.
 * Both operations are restart-safe and retain every legacy source object/row.
 */
export async function completePublishingUpgrade(database: D1Database, storage: R2Bucket, input: { actor: number; release: string }) {
  const conversion = await convertLegacyIntranet(database, storage, input)
  const portals = await seedPublishingPortals(database, input)
  const pending = await database.prepare(`SELECT COUNT(*) n FROM vc_knowledge_pages p WHERE p.kind='intranet' AND NOT EXISTS(SELECT 1 FROM vc_publishing_legacy_map m WHERE m.legacy_id=p.id)`).first<{ n: number }>()
  if (pending?.n) throw Error('Legacy Intranet conversion is incomplete. Retain maintenance protection.')
  return { converted: conversion.total, resumed: conversion.records.filter(record => record.resumed).length,
    portals: portals.records, dataPreserved: true }
}

export function requireAudienceSafeBaseline(input: { deployment: string; version: string; run: { phase: string; evidence: Record<string, unknown> } | null }) {
  const evidence = input.run?.evidence
  if (input.run?.phase !== 'complete' || !evidence || evidence.publishingAudienceSafe !== true ||
    evidence.deployment !== input.deployment || evidence.workerVersion !== input.version ||
    evidence.validationPassed !== true || evidence.livePassed !== true || evidence.loginVerified !== true ||
    typeof evidence.healthSeconds !== 'number' || evidence.healthSeconds < 600 || evidence.exceptions !== 0 || evidence.serverErrors !== 0 ||
    !/^[a-f0-9]{40}$/.test(String(evidence.source)) || !/^[a-f0-9]{64}$/.test(String(evidence.artifactHash)))
    throw Error('Deploy and verify an audience-safe recovery build before introducing internal Posts or Pages.')
}
