/** Frozen constituent identity schema. Chapter financial/activity records must remain site-owned. */
export const contactSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_constituents (
    id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES vc_organizations(id),
    source_site_id TEXT NOT NULL REFERENCES vc_sites(id), kind TEXT NOT NULL CHECK(kind IN('person','organization')),
    label TEXT NOT NULL, profile TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
    created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(id,organization_id)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_constituents_org_label_idx ON vc_crm_constituents(organization_id,label,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_affiliations (
    id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES vc_organizations(id),
    site_id TEXT NOT NULL REFERENCES vc_sites(id), constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    roles TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]',
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(site_id,constituent_id)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_affiliations_site_idx ON vc_crm_affiliations(site_id,archived,constituent_id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_affiliations_constituent_idx ON vc_crm_affiliations(constituent_id,site_id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_corrections (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id), actor_id INTEGER NOT NULL REFERENCES users(id),
    message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved','declined')),
    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_corrections_contact_idx ON vc_crm_corrections(constituent_id,status,created_at)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_source_identifiers (
    organization_id TEXT NOT NULL REFERENCES vc_organizations(id), site_id TEXT NOT NULL REFERENCES vc_sites(id),
    domain TEXT NOT NULL, platform TEXT NOT NULL, external_id TEXT NOT NULL, record_id TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(organization_id,site_id,domain,platform,external_id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_constituent_root_insert BEFORE INSERT ON vc_crm_constituents
    WHEN NOT EXISTS(SELECT 1 FROM vc_sites s WHERE s.id=NEW.source_site_id AND s.organization_id=NEW.organization_id)
    BEGIN SELECT RAISE(ABORT,'Invalid constituent organization'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_constituent_root_update BEFORE UPDATE OF source_site_id,organization_id ON vc_crm_constituents
    WHEN NEW.organization_id<>OLD.organization_id OR NEW.source_site_id<>OLD.source_site_id
    BEGIN SELECT RAISE(ABORT,'Constituent identity ownership is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_affiliation_root_insert BEFORE INSERT ON vc_crm_affiliations
    WHEN NOT EXISTS(SELECT 1 FROM vc_sites s JOIN vc_crm_constituents c ON c.organization_id=s.organization_id WHERE s.id=NEW.site_id AND c.id=NEW.constituent_id AND s.organization_id=NEW.organization_id)
    BEGIN SELECT RAISE(ABORT,'Invalid chapter relationship'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_affiliation_root_update BEFORE UPDATE OF organization_id,site_id,constituent_id ON vc_crm_affiliations
    WHEN NEW.organization_id<>OLD.organization_id OR NEW.site_id<>OLD.site_id OR NEW.constituent_id<>OLD.constituent_id
    BEGIN SELECT RAISE(ABORT,'Chapter relationship ownership is immutable'); END`,
] as const
