export const directorySchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_user_sites (
    id TEXT PRIMARY KEY NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), site TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), UNIQUE(user_id,site)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_user_sites_user_idx ON vc_user_sites(user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_site_idx ON vc_user_sites(user_id,site)`,
  `CREATE INDEX IF NOT EXISTS site_enabled_user_idx ON vc_user_sites(site,enabled,user_id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_directory_member_insert AFTER INSERT ON vc_site_memberships BEGIN
    INSERT INTO vc_user_sites(id,user_id,site,enabled) VALUES(NEW.site_id||':'||NEW.user_id,NEW.user_id,NEW.site_id,
      CASE WHEN NEW.active=1 AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=NEW.user_id AND a.disabled=1) THEN 1 ELSE 0 END); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_directory_member_update AFTER UPDATE ON vc_site_memberships BEGIN
    UPDATE vc_user_sites SET enabled=CASE WHEN NEW.active=1 AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=NEW.user_id AND a.disabled=1) THEN 1 ELSE 0 END
      WHERE user_id=NEW.user_id AND site=NEW.site_id; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_directory_member_delete AFTER DELETE ON vc_site_memberships BEGIN
    DELETE FROM vc_user_sites WHERE user_id=OLD.user_id AND site=OLD.site_id; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_directory_status_insert AFTER INSERT ON vc_account_status BEGIN
    UPDATE vc_user_sites SET enabled=CASE WHEN NEW.disabled=0 AND EXISTS(SELECT 1 FROM vc_site_memberships m WHERE m.user_id=NEW.user_id AND m.site_id=site AND m.active=1) THEN 1 ELSE 0 END WHERE user_id=NEW.user_id; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_directory_status_update AFTER UPDATE ON vc_account_status BEGIN
    UPDATE vc_user_sites SET enabled=CASE WHEN NEW.disabled=0 AND EXISTS(SELECT 1 FROM vc_site_memberships m WHERE m.user_id=NEW.user_id AND m.site_id=site AND m.active=1) THEN 1 ELSE 0 END WHERE user_id=NEW.user_id; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_directory_status_delete AFTER DELETE ON vc_account_status BEGIN
    UPDATE vc_user_sites SET enabled=CASE WHEN EXISTS(SELECT 1 FROM vc_site_memberships m WHERE m.user_id=OLD.user_id AND m.site_id=site AND m.active=1) THEN 1 ELSE 0 END WHERE user_id=OLD.user_id; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_directory_validate_insert BEFORE INSERT ON vc_user_sites WHEN
    NEW.id<>NEW.site||':'||NEW.user_id OR NOT EXISTS(SELECT 1 FROM vc_site_memberships m WHERE m.user_id=NEW.user_id AND m.site_id=NEW.site
      AND NEW.enabled=CASE WHEN m.active=1 AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=m.user_id AND a.disabled=1) THEN 1 ELSE 0 END)
    BEGIN SELECT RAISE(ABORT,'Directory membership is derived'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_directory_validate_update BEFORE UPDATE ON vc_user_sites WHEN
    NEW.id IS NOT OLD.id OR NEW.site IS NOT OLD.site OR NEW.user_id IS NOT OLD.user_id
    OR NOT EXISTS(SELECT 1 FROM vc_site_memberships m WHERE m.user_id=NEW.user_id AND m.site_id=NEW.site
      AND NEW.enabled=CASE WHEN m.active=1 AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=m.user_id AND a.disabled=1) THEN 1 ELSE 0 END)
    BEGIN SELECT RAISE(ABORT,'Directory membership is derived'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_directory_validate_delete BEFORE DELETE ON vc_user_sites
    WHEN EXISTS(SELECT 1 FROM vc_site_memberships m WHERE m.user_id=OLD.user_id AND m.site_id=OLD.site)
    BEGIN SELECT RAISE(ABORT,'Directory membership is derived'); END`,
  `INSERT OR IGNORE INTO vc_user_sites(id,user_id,site,enabled) SELECT m.site_id||':'||m.user_id,m.user_id,m.site_id,
    CASE WHEN m.active=1 AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=m.user_id AND a.disabled=1) THEN 1 ELSE 0 END FROM vc_site_memberships m`,
] as const
