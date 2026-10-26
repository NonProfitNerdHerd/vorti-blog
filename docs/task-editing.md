# Task editing and scheduling

Task dialogs keep an editable title and description above Details, Subtasks, Comments, Attachments and Dependencies. Boards with time-tracking columns also expose one Tracked Time tab containing their shared task timer, entries and correction history. Collaboration opens from the header icon. Dialogs keep their top position when switching panels.

Existing task fields save automatically: text after 600 ms or blur, and discrete choices immediately. Writes are serialized and carry the acknowledged task revision. Failed drafts remain editable and retryable; conflicts require explicit reload rather than overwriting someone else's changes. New popup drafts use Create task. Comments keep their explicit submission action.

Inline board entry accepts Enter immediately. A pending queue assigns temporary IDs, resolves parents before their children, and retains stable request keys on retry. `POST /api/task-workspace/create` accepts the ordinary task creation data plus a UUID `clientRequestKey`. A unique server-derived site/user/request key prevents duplicate creation. Reusing a key with different input returns a conflict. Normal creation hooks and access checks still run.

The additive `20261026_220000_task_creation_keys` migration adds nullable creation metadata to existing tasks and a separate dependency table for standalone boards. Existing project dependency records remain unchanged. Both dependency stores participate in cycle checks. A Worker rollback can retain this additive schema and its data.

Timeline bars open tasks, move by dragging or arrow keys, and resize using their ends. Scheduling changes only the edited task; connectors and conflict indicators show its dependencies. Calendar offers Due date, All Open Tasks and Created date display modes. Open spans include both endpoints; one available date appears once, while undated tasks remain separate. Creation timestamps use the site timezone.

Verification includes serialized-write and pending-parent tests, concurrent native creation retries, standalone dependency cycles, and browser coverage under delayed/failed requests, keyboard and pointer scheduling, calendar modes, combined time tracking, mobile layout and nested dialog focus.
