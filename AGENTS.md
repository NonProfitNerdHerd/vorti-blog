<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Development preview workflow

This installation is an unlaunched development preview. The user explicitly prefers fast web previews while UI and basic features are being developed. Apply this preference across chats without asking the user to repeat it for each prompt.

- Default to preview deployment and focused validation for requested changes. Full integration suites, full browser suites, full-platform acceptance, lengthy release observation, and elaborate release receipts are not routine requirements. Run the full deployment gauntlet only when the user requests it or explicitly begins launch preparation.
- For text, styling, layout, and other presentation changes, use the required build and a focused inspection of the affected page. Do not add tests for trivial presentation edits.
- For behavior changes, run only relevant checks. For authentication or permission changes, retain focused boundary checks; the established permissions should otherwise remain unchanged.
- Columns and schema migrations are allowed when needed for the requested feature. Inspect the migration, validate the affected schema/data behavior, and preserve existing preview data. A migration does not by itself require full-platform testing. Resets or destructive data changes require separate authorization.
- For deployments, use an application-only preview path for code-only changes; apply migrations only when required. Do not automatically invoke the generic deployment command that also runs database migrations. Check the actual package scripts: `deploy:preview` describes the preferred workflow but must not be claimed as an available command until implemented.
- Preserve existing resource bindings and data, and account for any active maintenance/release lock before deploying. Report the focused checks performed and any relevant limitations without treating omitted full-suite checks as a blocker for ordinary preview work.
- This user-authorized preview policy supersedes older repository release-document expectations for routine development previews. Keep the comprehensive release workflow available for later explicit use.
