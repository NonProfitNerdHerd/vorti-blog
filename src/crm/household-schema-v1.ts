/** Additive chapter-owned household and relationship records. Never rewrites donor identities. */
export const householdSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_households (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', primary_contact TEXT REFERENCES vc_crm_constituents(id),
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_households_site_idx ON vc_crm_households(site_id,archived,name,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_household_members (
    id TEXT PRIMARY KEY NOT NULL, household_id TEXT NOT NULL REFERENCES vc_crm_households(id),
    constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id), role TEXT NOT NULL DEFAULT '',
    started_on TEXT NOT NULL, ended_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
    CHECK(ended_on IS NULL OR ended_on>=started_on)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vc_crm_household_member_active_idx ON vc_crm_household_members(household_id,constituent_id) WHERE ended_on IS NULL`,
  `CREATE INDEX IF NOT EXISTS vc_crm_household_member_contact_idx ON vc_crm_household_members(constituent_id,household_id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_relationship_types (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    label TEXT NOT NULL, reciprocal_label TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
    revision INTEGER NOT NULL DEFAULT 1, UNIQUE(site_id,label)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_relationships (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    source_id TEXT NOT NULL REFERENCES vc_crm_constituents(id), target_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    type_id TEXT NOT NULL REFERENCES vc_crm_relationship_types(id), notes TEXT NOT NULL DEFAULT '',
    started_on TEXT NOT NULL, ended_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
    CHECK(source_id<>target_id), CHECK(ended_on IS NULL OR ended_on>=started_on)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_relationship_source_idx ON vc_crm_relationships(site_id,source_id,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_relationship_target_idx ON vc_crm_relationships(site_id,target_id,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_household_member_scope BEFORE INSERT ON vc_crm_household_members
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_households h JOIN vc_crm_affiliations a ON a.site_id=h.site_id
      JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0
      WHERE h.id=NEW.household_id AND h.archived=0 AND a.constituent_id=NEW.constituent_id AND a.archived=0)
    BEGIN SELECT RAISE(ABORT,'Household requires an active chapter contact'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_household_member_overlap BEFORE INSERT ON vc_crm_household_members
    WHEN EXISTS(SELECT 1 FROM vc_crm_household_members m WHERE m.household_id=NEW.household_id AND m.constituent_id=NEW.constituent_id
      AND (m.ended_on IS NULL OR m.ended_on>=NEW.started_on) AND (NEW.ended_on IS NULL OR NEW.ended_on>=m.started_on))
    BEGIN SELECT RAISE(ABORT,'Household membership dates overlap'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_household_primary_update BEFORE UPDATE OF primary_contact ON vc_crm_households
    WHEN NEW.primary_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_household_members m
      JOIN vc_crm_affiliations a ON a.constituent_id=m.constituent_id AND a.site_id=NEW.site_id AND a.archived=0
      WHERE m.household_id=NEW.id AND m.constituent_id=NEW.primary_contact AND m.ended_on IS NULL)
    BEGIN SELECT RAISE(ABORT,'Primary contact requires an active household member'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_relationship_scope BEFORE INSERT ON vc_crm_relationships
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_relationship_types t WHERE t.id=NEW.type_id AND t.site_id=NEW.site_id AND t.archived=0)
      OR (SELECT count(*) FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=NEW.site_id AND a.archived=0 AND a.constituent_id IN(NEW.source_id,NEW.target_id))<>2
    BEGIN SELECT RAISE(ABORT,'Relationship requires active chapter contacts and type'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_relationship_update_scope BEFORE UPDATE ON vc_crm_relationships
    WHEN NEW.site_id<>OLD.site_id OR NEW.source_id<>OLD.source_id OR NEW.target_id<>OLD.target_id OR NEW.type_id<>OLD.type_id
      OR (SELECT count(*) FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=NEW.site_id AND a.archived=0 AND a.constituent_id IN(NEW.source_id,NEW.target_id))<>2
    BEGIN SELECT RAISE(ABORT,'Relationship requires active chapter contacts'); END`,
] as const
