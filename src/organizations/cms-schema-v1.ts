import { cmsCollections } from './cms-collections'

/** Names are frozen application constants, not request identifiers. */
export const cmsOwnershipGuardsV1 = cmsCollections.flatMap(([slug, table, versions]) => {
  const validWrite = `EXISTS(SELECT 1 FROM vc_sites s JOIN vc_organizations o ON o.id=s.organization_id
    WHERE s.id=NEW.platform_site AND o.authority_revision=NEW.platform_write_epoch
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.platform_write_actor)
    AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=NEW.platform_write_actor AND a.disabled=1)
    AND NOT EXISTS(SELECT 1 FROM vc_site_ancestry a JOIN vc_sites p ON p.id=a.ancestor_id WHERE a.descendant_id=s.id AND p.archived=1))`
  return [
    `CREATE TRIGGER IF NOT EXISTS ${table}_vc_site_insert BEFORE INSERT ON "${table}" WHEN NOT (${validWrite}) BEGIN SELECT RAISE(ABORT,'CMS write authority changed'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_vc_site_update BEFORE UPDATE ON "${table}" WHEN NEW.platform_site IS NOT OLD.platform_site OR NOT (${validWrite}) BEGIN SELECT RAISE(ABORT,'CMS write authority changed'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_vc_site_delete BEFORE DELETE ON "${table}" WHEN NOT EXISTS(
      SELECT 1 FROM vc_cms_delete_proofs p JOIN vc_sites s ON s.id=p.site_id JOIN vc_organizations o ON o.id=s.organization_id
      WHERE p.collection='${slug}' AND p.record_id=CAST(OLD.id AS TEXT) AND p.site_id=OLD.platform_site AND p.authority_revision=o.authority_revision
      AND julianday(p.created_at)>=julianday('now','-5 minutes') AND julianday(p.created_at)<=julianday('now','+1 minute')
      AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=p.actor_id AND a.disabled=1)
      AND NOT EXISTS(SELECT 1 FROM vc_site_ancestry a JOIN vc_sites parent ON parent.id=a.ancestor_id WHERE a.descendant_id=s.id AND parent.archived=1))
      BEGIN SELECT RAISE(ABORT,'CMS delete authority changed'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_vc_site_deleted AFTER DELETE ON "${table}" BEGIN DELETE FROM vc_cms_delete_proofs WHERE collection='${slug}' AND record_id=CAST(OLD.id AS TEXT); END`,
    ...(versions
      ? [
          `CREATE TRIGGER IF NOT EXISTS ${versions}_vc_site_update BEFORE UPDATE OF version_platform_site ON "${versions}" WHEN NEW.version_platform_site IS NOT OLD.version_platform_site BEGIN SELECT RAISE(ABORT,'Version ownership is immutable'); END`,
        ]
      : []),
  ]
})
