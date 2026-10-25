# CRM conversations and assigned follow-ups

## Staff workflow

Open a constituent in CRM, choose Communications, and record the call or note. **Save and assign follow-up** saves the communication first, then carries its retained reference and subject into the follow-up panel. Choose New follow-up, select an eligible staff member, add details/due date, and create the Task. Saving a note alone creates no Task.

Follow-ups use the existing Tasks application. Open the Task title to work with its native editor, comments and files, or complete it from the CRM panel. Creation, completion and reopening events appear in the constituent timeline. Reloading the constituent retains saved communications and Tasks. Task completion does not create a gift, pledge, dues payment or volunteer hour.

## Access and retained history

Task access requires its existing personal/board audience **and** current identity, workspace and linked CRM category access in the owning chapter. A board audience alone does not grant donor access. The selected assignee must currently have the relevant CRM and workspace edit permissions. Other staff in the same chapter cannot read a private Task simply because they can read the constituent.

The typed reference and retry lineage are immutable. Subtasks inherit the CRM context. Source/permission revision checks protect initial creation, while subsequent reads and writes use current record availability. Completion/reopening events remain retained; losing access hides their titles and counts from CRM history. An identical retry of a confirmed creation returns the existing Task rather than creating another one.

The backend supports contacts, households, gifts, pledges, recurring schedules, memberships, opportunities and volunteer activities. The connected staff entry point in this milestone is constituent communications. Other record entry points and opportunity Boards remain unfinished, along with imports, controlled merges and reports/exports.

## Migration and recovery

`20261025_040000_crm_tasks` adds nullable native Task reference/retry columns, indexes, read-only context/constituent views, retained event records and guarded dependent writes. Payload's acronym columns are `crm_i_d` and `crm_activity_i_d`. Existing Task IDs, audiences and ordinary Task behavior are retained. Internal views disable document locking and reject public reads/writes; explicit association queries require a server-only Symbol.

Apply the reviewed migration before deploying the CRM-aware Worker. A conflicting physical context table is rejected for review rather than silently discarded. Only explicitly isolated local fixtures replace verified-empty schema-push tables with views. Production migration code does not drop those tables or their records.

After staff create CRM-linked Tasks, recovery must retain CRM-aware authorization. **Do not roll back to a pre-CRM-Tasks Worker while retaining those new Tasks**: that older binary cannot enforce their additional CRM permissions. Preserve the verified CRM-aware artifact for forward recovery, and review database restoration separately against any intervening production writes. No destructive down migration is provided.

## Current verification

Local native Payload/workerd/D1 checks cover assignment, one-time creation/retry, native completion, constituent Task history and revoked affiliation. Existing native Tasks sharing/privacy regressions pass. Focused history cases cover full pagination, private and board audiences, permission revocation and removal of cached titles. Authenticated optimized-Worker acceptance covers a saved phone note, another staff assignee, native editor completion, reload, mobile layout and the constituent timeline.

The constituent workflow is deployed from source `4a9113a1671f34a4340f199d04ad1b92deb99ff0` as Worker `75c3a046-5ae3-493a-bcaa-0649f293d3d6`; migration ledger 56 and retained production table counts are verified. All thirteen CRM browser workflows and 263 CRM/organization cases pass. Signed-in production smoke remains pending the browser login; public pages and anonymous private-access denials pass. This milestone requires no email provider or external marketing/accounting integration.
