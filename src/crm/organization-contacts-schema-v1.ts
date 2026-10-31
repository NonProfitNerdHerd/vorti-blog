/** Chapter-owned contact people; general constituent relationships remain independent. */
export const organizationContactsSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_organization_contacts (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    organization_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    person_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    role TEXT NOT NULL DEFAULT '', starts_on TEXT NOT NULL, ends_on TEXT,
    notes TEXT NOT NULL DEFAULT '', primary_contact INTEGER NOT NULL DEFAULT 0 CHECK(primary_contact IN(0,1)),
    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    CHECK(ends_on IS NULL OR ends_on>=starts_on), CHECK(organization_id<>person_id)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_organization_contacts_org_idx ON vc_crm_organization_contacts(site_id,organization_id,person_id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_organization_contacts_person_idx ON vc_crm_organization_contacts(site_id,person_id,organization_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vc_crm_organization_contacts_primary_idx ON vc_crm_organization_contacts(site_id,organization_id) WHERE primary_contact=1 AND ends_on IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vc_crm_organization_contacts_active_idx ON vc_crm_organization_contacts(site_id,organization_id,person_id) WHERE ends_on IS NULL`,
  ...['INSERT', 'UPDATE'].map(event => `CREATE TRIGGER IF NOT EXISTS vc_crm_organization_contacts_scope_${event.toLowerCase()} BEFORE ${event} ON vc_crm_organization_contacts
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 AND c.kind='organization'
      WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.organization_id AND a.archived=0)
      OR NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 AND c.kind='person'
      WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.person_id AND a.archived=0)
    BEGIN SELECT RAISE(ABORT,'Organization contacts require an organization and person in this chapter'); END`),
  `CREATE TRIGGER IF NOT EXISTS vc_crm_organization_contacts_owner_fixed BEFORE UPDATE OF site_id,organization_id,person_id,created_at ON vc_crm_organization_contacts
    BEGIN SELECT RAISE(ABORT,'Organization contact ownership is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_organization_contacts_no_delete BEFORE DELETE ON vc_crm_organization_contacts
    BEGIN SELECT RAISE(ABORT,'Organization contact history is retained'); END`,
] as const
