/** Frozen additive website schema. Availability never grants staff authority. */
export const websiteSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_site_websites (
    site_id TEXT PRIMARY KEY NOT NULL REFERENCES vc_sites(id),
    subsites_enabled INTEGER NOT NULL DEFAULT 0 CHECK(subsites_enabled IN(0,1)),
    published INTEGER NOT NULL DEFAULT 0 CHECK(published IN(0,1)),
    initialized INTEGER NOT NULL DEFAULT 0 CHECK(initialized IN(0,1)),
    revision INTEGER NOT NULL DEFAULT 1,
    presentation TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(presentation)),
    navigation TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(navigation))
  )`,
  `INSERT OR IGNORE INTO vc_site_websites(site_id) SELECT id FROM vc_sites`,
  `CREATE TRIGGER IF NOT EXISTS vc_website_site_insert AFTER INSERT ON vc_sites BEGIN
    INSERT INTO vc_site_websites(site_id) VALUES(NEW.id); END`,
  ...['INSERT', 'UPDATE', 'DELETE'].map(
    (operation) =>
      `CREATE TRIGGER IF NOT EXISTS vc_website_authority_${operation.toLowerCase()} AFTER ${operation} ON vc_site_websites BEGIN
      UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=${operation === 'DELETE' ? 'OLD' : 'NEW'}.site_id); END`,
  ),
] as const

/** Includes the target for provisioning children, excludes it for its own public availability. */
export const disabledAncestorSQL = (
  includeSelf: boolean,
) => `SELECT p.id,p.name FROM vc_site_ancestry a
  JOIN vc_sites p ON p.id=a.ancestor_id LEFT JOIN vc_site_websites w ON w.site_id=p.id
  WHERE a.descendant_id=? AND a.distance${includeSelf ? '>=' : '>'}0
    AND (p.archived=1 OR COALESCE(w.subsites_enabled,0)=0)
  ORDER BY a.distance DESC LIMIT 1`
