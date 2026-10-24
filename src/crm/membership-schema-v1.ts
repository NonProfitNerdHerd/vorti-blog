export const membershipSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_membership_types (
    id TEXT PRIMARY KEY NOT NULL,site_id TEXT NOT NULL REFERENCES vc_sites(id),name TEXT NOT NULL,
    eligibility TEXT NOT NULL CHECK(eligibility IN('person','household')),term_months INTEGER NOT NULL CHECK(term_months BETWEEN 1 AND 120),
    dues_minor TEXT NOT NULL,currency TEXT NOT NULL,exponent INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(site_id,name)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_membership_terms (
    id TEXT PRIMARY KEY NOT NULL,site_id TEXT NOT NULL REFERENCES vc_sites(id),type_id TEXT NOT NULL REFERENCES vc_crm_membership_types(id),
    person_id TEXT REFERENCES vc_crm_constituents(id),household_id TEXT REFERENCES vc_crm_households(id),billing_contact_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    type_name TEXT NOT NULL,starts_on TEXT NOT NULL,ends_on TEXT NOT NULL,dues_minor TEXT NOT NULL,currency TEXT NOT NULL,exponent INTEGER NOT NULL,
    dues_commitment_id TEXT REFERENCES vc_crm_commitments(id),renewed_from TEXT UNIQUE REFERENCES vc_crm_membership_terms(id),cancelled_on TEXT,revision INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
    CHECK((person_id IS NULL)<>(household_id IS NULL)),CHECK(ends_on>=starts_on)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_membership_terms_site_idx ON vc_crm_membership_terms(site_id,ends_on,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_membership_terms_person_idx ON vc_crm_membership_terms(site_id,person_id,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_membership_coverage (
    term_id TEXT NOT NULL REFERENCES vc_crm_membership_terms(id),constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),PRIMARY KEY(term_id,constituent_id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_membership_term_scope BEFORE INSERT ON vc_crm_membership_terms
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_membership_types t WHERE t.id=NEW.type_id AND t.site_id=NEW.site_id AND t.archived=0
      AND ((t.eligibility='person' AND NEW.person_id=NEW.billing_contact_id AND NEW.household_id IS NULL) OR (t.eligibility='household' AND NEW.household_id IS NOT NULL AND NEW.person_id IS NULL)))
      OR NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.billing_contact_id AND a.archived=0)
      OR (NEW.household_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_households h WHERE h.id=NEW.household_id AND h.site_id=NEW.site_id AND h.archived=0))
    BEGIN SELECT RAISE(ABORT,'Membership requires an active chapter type and recipient'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_membership_eligibility_fixed BEFORE UPDATE OF eligibility ON vc_crm_membership_types
    WHEN NEW.eligibility<>OLD.eligibility AND EXISTS(SELECT 1 FROM vc_crm_membership_terms WHERE type_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Create a separate membership type to change eligibility after enrollment'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_membership_coverage_scope BEFORE INSERT ON vc_crm_membership_coverage
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_membership_terms t JOIN vc_crm_constituents c ON c.id=NEW.constituent_id AND c.archived=0
      JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=t.site_id AND a.archived=0 WHERE t.id=NEW.term_id
      AND (t.person_id=c.id OR EXISTS(SELECT 1 FROM vc_crm_household_members m WHERE m.household_id=t.household_id AND m.constituent_id=c.id AND m.started_on<=t.starts_on AND (m.ended_on IS NULL OR m.ended_on>=t.starts_on))))
    BEGIN SELECT RAISE(ABORT,'Membership coverage requires an authorized recipient at the term start'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_membership_overlap BEFORE INSERT ON vc_crm_membership_terms
    WHEN EXISTS(SELECT 1 FROM vc_crm_membership_terms t WHERE t.site_id=NEW.site_id AND t.type_id=NEW.type_id AND t.person_id IS NEW.person_id AND t.household_id IS NEW.household_id
      AND t.starts_on<=NEW.ends_on AND t.ends_on>=NEW.starts_on AND (t.cancelled_on IS NULL OR t.cancelled_on>NEW.starts_on))
    BEGIN SELECT RAISE(ABORT,'Membership terms overlap'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_membership_terms_immutable BEFORE UPDATE OF site_id,type_id,person_id,household_id,billing_contact_id,type_name,starts_on,ends_on,dues_minor,currency,exponent,dues_commitment_id,renewed_from,created_by,created_at ON vc_crm_membership_terms
    BEGIN SELECT RAISE(ABORT,'Membership terms are retained; cancel or renew explicitly'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_membership_terms_no_delete BEFORE DELETE ON vc_crm_membership_terms BEGIN SELECT RAISE(ABORT,'Membership history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_membership_coverage_no_update BEFORE UPDATE ON vc_crm_membership_coverage BEGIN SELECT RAISE(ABORT,'Covered-member history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_membership_coverage_no_delete BEFORE DELETE ON vc_crm_membership_coverage BEGIN SELECT RAISE(ABORT,'Covered-member history is retained'); END`,
] as const
