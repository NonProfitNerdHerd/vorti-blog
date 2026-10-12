# Content framework release

Recovery baseline: Worker `febb9a35-f24c-424c-896b-4355a5a496f3`, commit `bcdf451d4addd5cdd000350225dc5e37bac40c20`.

D1 bookmark recorded before production changes on 2026-10-12 UTC: `000000d7-00000000-00005102-32a8979e8d7e230b04e48625089a2267`.

Validation completed locally:

- 108 framework tests across 22 files.
- 46 integration tests across 11 files, including Tasks, Templates, Site Shell and migration tests; final publication-reference assertions also passed on rerun.
- All 36 display families rendered at desktop, tablet and phone sizes; dark mode and reduced motion included.
- Saved View admin editing, pagination, switchable calendar navigation and dialog keyboard dismissal passed.
- Existing 15 editor/Tasks browser scenarios passed across the full run and targeted reruns. The Posts test now selects Author by field identity rather than its position among relationship fields. A transient local connection reset in the Site Template scenario passed on rerun.
- Type checks and lint passed (31 lint warnings, no errors).

No existing sample records were removed. Demonstration setup adds labeled records and reuses existing media. The migration preserves accounts, credentials, media, settings and review history.

See [framework documentation and capability matrix](content-framework.md) for routes, operation and implementation limits. Production commit and Worker version are reported in the delivery message and Git/Cloudflare deployment history.
