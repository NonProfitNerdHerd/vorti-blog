# Unified public and internal publishing

Posts and Pages share their existing editors, blocks, templates, revisions and
publishing controls. Their stored audience is `public` or `intranet`. Public lists
remain the default; Intranet navigation requests internal lists explicitly.
Individual-record authorization always resolves the stored audience. Filters and
site/audience headers are selection hints, never grants.

## Readership and files

Published internal documents are readable by permitted site members unless
restricted to their author and selected people/site sharing groups. Empty restricted
selections never become site-wide. Page ancestry and current group membership
restrict descendant access. Tenant Administrator visibility remains an explicit,
audited exception; Site Administrator status grants no private-content bypass.
Editing, publishing and history remain separate permissions.

Internal files live under server-managed prefixes in the protected bucket.
Document uploads inherit current readership and stay linked to an immutable source
identity. Draft uploads require history access until their source is published.
Moving a source publicly does not publish its old private files or history. Public
publication rejects unresolved private dependencies. Saved export files are private
and carry source manifests checked against current access at download time.

Public and Intranet shells use the existing Site Template builder. The assigned
public template is designated Main; the assigned internal template is independently
editable. Each site has separate internal homepage and navigation settings. Default
portal seeding is idempotent and preserves existing customizations and selections.
Wiki remains a separate knowledge system.

## Copy and move

Ordinary updates cannot change audience. Copy/Move uses an explicit revision-fenced,
audited and idempotent operation. The destination is always a draft. Moves retain
history, and copies record lineage. A published source requires unpublish authority
before moving. Review taxonomy, hierarchy, files, views and links before publishing
in the destination. Previously public copies cannot be made confidential retroactively.

## Data-preserving deployment

Do not reset, reseed an existing installation, purge queues or remove legacy tables.
Apply the complete registered migration chain; never manufacture ledger entries.

1. Verify live deployment, bindings, current main, content/file inventory, complete
   migration ledger and foreign keys. Reconcile intervening releases.
2. Deploy and verify the frozen audience-safe compatibility package first. Record
   its completed operational run, exact Worker identity and continuous health result.
   Never recover to a pre-audience Worker after internal shared records exist.
3. Freeze the final source, run all validation and full browser acceptance against
   its immutable package, then commit/push the exact accepted application source.
4. Acquire an upgrade lease. Pause queue delivery without purging, activate
   maintenance, drain writers and install database guards. Capture a fresh private
   export and restore-check integrity/foreign keys before migration.
5. Invoke `scripts/upgrade-release-database.ts --action migrate` using the exact
   manifest, package, passing source/browser reports, fresh recovery receipt and
   `--compatibility-run`. Production intent and administrator identity are required.
   This applies migration 63, converts legacy Intranet records/files/history, and
   initializes independent portal defaults. Source legacy records remain intact.
   Unsupported legacy import/export records stop this first upgrade before changes;
   they require verified file/provenance conversion rather than invented ownership.
6. Deploy the tested package without rebuilding. Recheck deployment identity and
   bindings. For `--action verification-thaw`, provide `--deployment` and the
   matching `--upgrade-receipt` produced by the successful migrate action. Ledger
   equality alone is insufficient: conversion and portal completion are checked.
7. Verify administrator login and protected public behavior, reopen under observation,
   resume preserved jobs, then verify publishing, sharing, protected files, templates,
   public behavior and preserved current data. Retained jobs execute only as their
   stored owner/site/audience; missing provenance remains blocked for reconciliation.
8. Observe at least 600 continuous seconds after logging attaches, with successful
   correlated probes, no gaps, and zero errors/exceptions. Restart an invalid window.
9. Complete the lease, remove only this release's inventoried temporary recovery
   material and runtimes, and commit/push a non-sensitive final receipt. Distinguish
   the deployed application commit from any later documentation-only commit.

Migration metadata backfill restores the exact original triggers in the same atomic
D1 batch that temporarily removes them. It changes no historical actor, authority
epoch or application body. An aborted batch cannot leave ordinary writes unguarded.
Recovery uses the tested compatible Worker and a matching database strategy; Worker
rollback alone does not restore data.
