# Starter Tasks workspace

The first Tasks workspace visit initializes a private **Work** project and its inherited **Personal To-Do's** board for the signed-in account. Existing accounts use the same first-visit flow as new accounts. Existing work is not renamed or adopted based on display names.

`POST /api/task-workspace/initialize` accepts no account selection. The server derives the owner from authentication, uses unique internal starter keys, and records `users.workspaceInitialized` only after the project, board, five default views, and Estimated hours column exist. These fields are server-managed. Concurrent creation resolves to the same records; an interrupted request can resume on the next visit. Default board metadata uses the same atomic initializer as ordinary board creation.

Archive is the supported removal workflow. Initialization searches include archived records, and completed accounts are never reseeded. Renaming, archiving, restoring, or removing a default view after initialization does not reset the marker. Permanent deletion is outside this feature.

The workspace navigator keeps project expansion in the existing per-user project preferences. Project names open their overview. Each project’s **+** opens Create project, independently of expansion. The Projects directory and main admin Tasks submenu remain available; only the redundant top workspace tab is removed.

The additive migration is `20261019_145037_starter_workspace`. Before production migration, record a D1 Time Travel bookmark. Its down migration intentionally refuses to discard initialization history.
