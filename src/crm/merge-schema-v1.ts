/** Draft additive merge storage. Do not register/enable staff approval before
 * all live domains use the versioned lineage resolver and guarded publication. */
export const mergeSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_merges (
    id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL REFERENCES vc_organizations(id),
    site_id TEXT NOT NULL REFERENCES vc_sites(id),actor_id INTEGER NOT NULL REFERENCES users(id),
    survivor_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),duplicate_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN('draft','preparing','ready','approved','applying','completed','failed','cancelled')),
    revision INTEGER NOT NULL DEFAULT 1,review_id TEXT REFERENCES vc_crm_merge_reviews(id),job_id TEXT REFERENCES vc_crm_jobs(id),
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,CHECK(survivor_id<>duplicate_id)
  )`,
  'CREATE INDEX IF NOT EXISTS vc_crm_merge_actor_idx ON vc_crm_merges(site_id,actor_id,created_at,id)',
  `CREATE TABLE IF NOT EXISTS vc_crm_merge_reviews (
    id TEXT PRIMARY KEY NOT NULL,merge_id TEXT NOT NULL REFERENCES vc_crm_merges(id),
    request_revision INTEGER NOT NULL,authority_revision INTEGER NOT NULL,
    survivor_revision INTEGER NOT NULL,duplicate_revision INTEGER NOT NULL,
    survivor_snapshot TEXT NOT NULL CHECK(json_valid(survivor_snapshot)),
    duplicate_snapshot TEXT NOT NULL CHECK(json_valid(duplicate_snapshot)),
    decisions_json TEXT NOT NULL CHECK(json_valid(decisions_json)),
    created_at TEXT NOT NULL,UNIQUE(merge_id,request_revision)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_merge_items (
    review_id TEXT NOT NULL REFERENCES vc_crm_merge_reviews(id),kind TEXT NOT NULL,cursor_key TEXT NOT NULL,
    site_id TEXT NOT NULL REFERENCES vc_sites(id),record_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
    PRIMARY KEY(review_id,kind,cursor_key)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_merge_seals (
    review_id TEXT PRIMARY KEY NOT NULL REFERENCES vc_crm_merge_reviews(id),
    manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64),item_count INTEGER NOT NULL CHECK(item_count>=0),
    authority_revision INTEGER NOT NULL,created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_merge_approvals (
    review_id TEXT PRIMARY KEY NOT NULL REFERENCES vc_crm_merge_seals(review_id),
    actor_id INTEGER NOT NULL REFERENCES users(id),authority_revision INTEGER NOT NULL,
    manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64),created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_identity_aliases (
    identity_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL REFERENCES vc_organizations(id),canonical_id TEXT NOT NULL,
    merge_id TEXT NOT NULL REFERENCES vc_crm_merges(id),revision INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(identity_id,organization_id) REFERENCES vc_crm_constituents(id,organization_id),
    FOREIGN KEY(canonical_id,organization_id) REFERENCES vc_crm_constituents(id,organization_id),
    CHECK(identity_id<>canonical_id)
  )`,
  'CREATE INDEX IF NOT EXISTS vc_crm_alias_canonical_idx ON vc_crm_identity_aliases(organization_id,canonical_id,identity_id)',
  `CREATE TABLE IF NOT EXISTS vc_crm_merge_events (
    id TEXT PRIMARY KEY NOT NULL,merge_id TEXT NOT NULL REFERENCES vc_crm_merges(id),
    kind TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),detail TEXT NOT NULL CHECK(json_valid(detail)),created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS vc_crm_merge_events_idx ON vc_crm_merge_events(merge_id,created_at,id)',
  `CREATE TABLE IF NOT EXISTS vc_crm_merge_locks (
    identity_id TEXT PRIMARY KEY NOT NULL REFERENCES vc_crm_constituents(id),merge_id TEXT NOT NULL REFERENCES vc_crm_merges(id),
    job_id TEXT NOT NULL REFERENCES vc_crm_jobs(id),fence INTEGER NOT NULL,lease_until TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_merge_scope BEFORE INSERT ON vc_crm_merges
    WHEN NOT EXISTS(SELECT 1 FROM vc_sites s JOIN vc_crm_constituents a ON a.organization_id=s.organization_id
      JOIN vc_crm_constituents b ON b.organization_id=s.organization_id
      WHERE s.id=NEW.site_id AND s.organization_id=NEW.organization_id AND a.id=NEW.survivor_id AND b.id=NEW.duplicate_id)
    BEGIN SELECT RAISE(ABORT,'Merge requires one organization root'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_merge_owner BEFORE UPDATE OF id,organization_id,site_id,actor_id,survivor_id,duplicate_id,created_at ON vc_crm_merges
    BEGIN SELECT RAISE(ABORT,'Merge ownership and original identities are retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_merge_initial_review BEFORE INSERT ON vc_crm_merges WHEN NEW.review_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT,'Create a merge request before attaching its review'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_merge_review_context BEFORE UPDATE OF review_id ON vc_crm_merges
    WHEN NEW.review_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_merge_reviews v WHERE v.id=NEW.review_id AND v.merge_id=NEW.id)
    BEGIN SELECT RAISE(ABORT,'Merge review belongs to another request'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_merge_sealed BEFORE INSERT ON vc_crm_merge_items
    WHEN EXISTS(SELECT 1 FROM vc_crm_merge_seals s WHERE s.review_id=NEW.review_id)
    BEGIN SELECT RAISE(ABORT,'Sealed merge manifests are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_merge_approval_context BEFORE INSERT ON vc_crm_merge_approvals
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_merge_seals s JOIN vc_crm_merge_reviews v ON v.id=s.review_id
      JOIN vc_crm_merges m ON m.id=v.merge_id JOIN vc_organizations o ON o.id=m.organization_id
      WHERE s.review_id=NEW.review_id AND m.review_id=v.id AND m.state='ready'
      AND s.manifest_hash=NEW.manifest_hash AND s.authority_revision=NEW.authority_revision AND o.authority_revision=NEW.authority_revision)
    BEGIN SELECT RAISE(ABORT,'Merge approval does not match the sealed review'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_merge_seal_context BEFORE INSERT ON vc_crm_merge_seals
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_merge_reviews v JOIN vc_crm_merges m ON m.id=v.merge_id
      JOIN vc_organizations o ON o.id=m.organization_id WHERE v.id=NEW.review_id
      AND v.authority_revision=NEW.authority_revision AND o.authority_revision=NEW.authority_revision)
    BEGIN SELECT RAISE(ABORT,'Merge review permissions changed before sealing'); END`,
  ...['INSERT', 'UPDATE'].map(
    (
      event,
    ) => `CREATE TRIGGER IF NOT EXISTS vc_crm_alias_terminal_${event.toLowerCase()} BEFORE ${event} ON vc_crm_identity_aliases
    WHEN EXISTS(SELECT 1 FROM vc_crm_identity_aliases a WHERE a.identity_id=NEW.canonical_id)
      OR EXISTS(SELECT 1 FROM vc_crm_identity_aliases a WHERE a.canonical_id=NEW.identity_id)
      OR NOT EXISTS(SELECT 1 FROM vc_crm_merges m JOIN vc_crm_merge_approvals p ON p.review_id=m.review_id
        JOIN vc_organizations o ON o.id=m.organization_id
        WHERE m.id=NEW.merge_id AND m.organization_id=NEW.organization_id AND m.state='applying'
        AND m.survivor_id=NEW.canonical_id AND p.authority_revision=o.authority_revision
        AND ${event === 'UPDATE' ? 'OLD.canonical_id=m.duplicate_id' : 'NEW.identity_id=m.duplicate_id'})
    BEGIN SELECT RAISE(ABORT,'Merge aliases must resolve directly within one organization'); END`,
  ),
  `CREATE TRIGGER IF NOT EXISTS vc_crm_alias_owner BEFORE UPDATE OF identity_id,organization_id ON vc_crm_identity_aliases
    BEGIN SELECT RAISE(ABORT,'Original identity lineage is retained'); END`,
  ...[
    'vc_crm_merge_reviews',
    'vc_crm_merge_items',
    'vc_crm_merge_seals',
    'vc_crm_merge_approvals',
    'vc_crm_merge_events',
  ].flatMap((table) =>
    ['UPDATE', 'DELETE'].map(
      (event) =>
        `CREATE TRIGGER IF NOT EXISTS ${table}_${event.toLowerCase()} BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'Merge history is append-only'); END`,
    ),
  ),
  ...['vc_crm_merges', 'vc_crm_identity_aliases'].map(
    (table) =>
      `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Merge lineage is retained'); END`,
  ),
] as const
