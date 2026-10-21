/** Private financial runtime schema. Amounts are canonical integer strings, never SQLite REAL. */
export const financeSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_funds (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id), name TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(site_id,name)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_funds_site_idx ON vc_crm_funds(site_id,archived,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_gifts (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id), currency TEXT NOT NULL, exponent INTEGER NOT NULL CHECK(exponent BETWEEN 0 AND 4),
    original_minor TEXT NOT NULL, net_minor TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN('cash','check','external-online','in-kind')),
    state TEXT NOT NULL DEFAULT 'posted' CHECK(state IN('posted','void')), received_on TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', allocations TEXT NOT NULL, net_allocations TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_gifts_site_idx ON vc_crm_gifts(site_id,received_on,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_gifts_contact_idx ON vc_crm_gifts(site_id,constituent_id,received_on,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_gift_adjustments (
    id TEXT PRIMARY KEY NOT NULL, gift_id TEXT NOT NULL REFERENCES vc_crm_gifts(id),
    action TEXT NOT NULL CHECK(action IN('refund','correction','void')), delta_minor TEXT NOT NULL, allocations TEXT NOT NULL,
    reason TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_gift_adjustments_gift_idx ON vc_crm_gift_adjustments(gift_id,created_at,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_gift_immutable BEFORE UPDATE OF site_id,constituent_id,currency,exponent,original_minor,kind,received_on,allocations,created_by,reference,notes ON vc_crm_gifts
    BEGIN SELECT RAISE(ABORT,'Original gift is immutable; record an adjustment'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_gift_no_delete BEFORE DELETE ON vc_crm_gifts BEGIN SELECT RAISE(ABORT,'Gift history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_adjustment_no_update BEFORE UPDATE ON vc_crm_gift_adjustments BEGIN SELECT RAISE(ABORT,'Financial adjustments are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_adjustment_no_delete BEFORE DELETE ON vc_crm_gift_adjustments BEGIN SELECT RAISE(ABORT,'Financial adjustments are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_gift_affiliation BEFORE INSERT ON vc_crm_gifts
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.constituent_id AND a.archived=0)
    BEGIN SELECT RAISE(ABORT,'Gift requires a chapter relationship'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_gift_funds BEFORE INSERT ON vc_crm_gifts
    WHEN EXISTS(SELECT 1 FROM json_each(NEW.allocations) a WHERE NOT EXISTS(SELECT 1 FROM vc_crm_funds f WHERE f.id=json_extract(a.value,'$.fund') AND f.site_id=NEW.site_id AND f.archived=0))
    BEGIN SELECT RAISE(ABORT,'Gift fund is unavailable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_gift_precision BEFORE INSERT ON vc_crm_gifts
    WHEN EXISTS(SELECT 1 FROM vc_crm_gifts g WHERE g.site_id=NEW.site_id AND g.currency=NEW.currency AND g.exponent<>NEW.exponent)
    BEGIN SELECT RAISE(ABORT,'Currency precision is immutable'); END`,
] as const
