/** Skills, chapter activity, correspondence and hours are independently authorized domains. */
export const volunteerSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_volunteer_profiles (
    site_id TEXT NOT NULL REFERENCES vc_sites(id),constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    skills TEXT NOT NULL DEFAULT '[]',interests TEXT NOT NULL DEFAULT '[]',availability TEXT NOT NULL DEFAULT '',
    do_not_contact INTEGER NOT NULL DEFAULT 0 CHECK(do_not_contact IN(0,1)),archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),revision INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(site_id,constituent_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_volunteer_activities (
    id TEXT PRIMARY KEY NOT NULL,site_id TEXT NOT NULL REFERENCES vc_sites(id),name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',
    starts_on TEXT NOT NULL,ends_on TEXT NOT NULL,skills TEXT NOT NULL DEFAULT '[]',state TEXT NOT NULL DEFAULT 'planned' CHECK(state IN('planned','completed','cancelled')),
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),revision INTEGER NOT NULL DEFAULT 1,CHECK(ends_on>=starts_on)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_volunteer_activity_site_idx ON vc_crm_volunteer_activities(site_id,starts_on,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_volunteer_participation (
    id TEXT PRIMARY KEY NOT NULL,activity_id TEXT NOT NULL REFERENCES vc_crm_volunteer_activities(id),constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    state TEXT NOT NULL CHECK(state IN('registered','attended','cancelled')),notes TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,UNIQUE(activity_id,constituent_id)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_volunteer_participation_contact_idx ON vc_crm_volunteer_participation(constituent_id,activity_id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_volunteer_invitations (
    id TEXT PRIMARY KEY NOT NULL,activity_id TEXT NOT NULL REFERENCES vc_crm_volunteer_activities(id),constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    channel TEXT NOT NULL CHECK(channel IN('phone','email','letter','other')),occurred_on TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',
    response TEXT NOT NULL DEFAULT 'pending' CHECK(response IN('pending','accepted','declined','withdrawn')),responded_on TEXT,response_notes TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(activity_id,constituent_id)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_volunteer_invitation_contact_idx ON vc_crm_volunteer_invitations(constituent_id,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_volunteer_hours (
    id TEXT PRIMARY KEY NOT NULL,activity_id TEXT NOT NULL REFERENCES vc_crm_volunteer_activities(id),constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    occurred_on TEXT NOT NULL,minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 1440),state TEXT NOT NULL DEFAULT 'submitted' CHECK(state IN('submitted','approved','rejected')),
    review_reason TEXT NOT NULL DEFAULT '',reviewed_by INTEGER REFERENCES users(id),reviewed_at TEXT,revision INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_volunteer_hours_activity_idx ON vc_crm_volunteer_hours(activity_id,state,occurred_on,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_volunteer_hours_contact_idx ON vc_crm_volunteer_hours(constituent_id,occurred_on,id)`,
  ...['INSERT', 'UPDATE'].map(
    (
      event,
    ) => `CREATE TRIGGER IF NOT EXISTS vc_crm_volunteer_profile_scope_${event.toLowerCase()} BEFORE ${event} ON vc_crm_volunteer_profiles
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.archived=0 WHERE c.id=NEW.constituent_id AND c.kind='person' AND c.archived=0 AND a.site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Volunteer profiles require an active chapter person'); END`,
  ),
  ...['participation', 'invitations'].flatMap((table) =>
    ['INSERT', 'UPDATE'].map(
      (
        event,
      ) => `CREATE TRIGGER IF NOT EXISTS vc_crm_volunteer_${table}_scope_${event.toLowerCase()} BEFORE ${event} ON vc_crm_volunteer_${table}
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_volunteer_activities v JOIN vc_crm_affiliations a ON a.site_id=v.site_id AND a.constituent_id=NEW.constituent_id AND a.archived=0 JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 AND c.kind='person' WHERE v.id=NEW.activity_id)
    BEGIN SELECT RAISE(ABORT,'Volunteer activity records require a person in that chapter'); END`,
    ),
  ),
  `CREATE TRIGGER IF NOT EXISTS vc_crm_volunteer_invitation_consent BEFORE INSERT ON vc_crm_volunteer_invitations
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_volunteer_activities a JOIN vc_crm_volunteer_profiles v ON v.site_id=a.site_id AND v.constituent_id=NEW.constituent_id
      JOIN vc_crm_constituents c ON c.id=v.constituent_id WHERE a.id=NEW.activity_id AND a.state='planned' AND a.archived=0 AND v.archived=0 AND v.do_not_contact=0 AND json_extract(c.profile,'$.communication.volunteerAllowed') IS NOT 0)
    BEGIN SELECT RAISE(ABORT,'Volunteer outreach requires current consent and a planned activity'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_volunteer_hours_scope BEFORE INSERT ON vc_crm_volunteer_hours
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_volunteer_activities v JOIN vc_crm_volunteer_participation p ON p.activity_id=v.id AND p.constituent_id=NEW.constituent_id AND p.state='attended'
      JOIN vc_crm_affiliations a ON a.site_id=v.site_id AND a.constituent_id=p.constituent_id AND a.archived=0 JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0
      WHERE v.id=NEW.activity_id AND NEW.occurred_on BETWEEN v.starts_on AND v.ends_on AND v.state<>'cancelled' AND v.archived=0)
    BEGIN SELECT RAISE(ABORT,'Hours require attended chapter participation within the activity dates'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_volunteer_hours_review_scope BEFORE UPDATE ON vc_crm_volunteer_hours
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_volunteer_activities v JOIN vc_crm_affiliations a ON a.site_id=v.site_id AND a.constituent_id=NEW.constituent_id AND a.archived=0 JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE v.id=NEW.activity_id)
    BEGIN SELECT RAISE(ABORT,'Hours review requires chapter access'); END`,
  ...[
    ['profiles', 'site_id,constituent_id'],
    ['activities', 'site_id'],
    ['participation', 'activity_id,constituent_id'],
    ['invitations', 'activity_id,constituent_id,channel,occurred_on,notes,created_by,created_at'],
    ['hours', 'activity_id,constituent_id,occurred_on,minutes,created_by,created_at'],
  ].map(
    ([table, fields]) =>
      `CREATE TRIGGER IF NOT EXISTS vc_crm_volunteer_${table}_owner_fixed BEFORE UPDATE OF ${fields} ON vc_crm_volunteer_${table} BEGIN SELECT RAISE(ABORT,'Volunteer original records and ownership are retained'); END`,
  ),
  ...['profiles', 'activities', 'participation', 'invitations', 'hours'].map(
    (table) =>
      `CREATE TRIGGER IF NOT EXISTS vc_crm_volunteer_${table}_no_delete BEFORE DELETE ON vc_crm_volunteer_${table} BEGIN SELECT RAISE(ABORT,'Volunteer history is retained'); END`,
  ),
] as const
