# Document review tasks

Open **Tasks** in a saved document's header to review it without changing or publishing its content. The previous inspector and block selection return when the panel closes. Use **Review → Tasks** in the main navigation to search across documents, filter assignments or due dates, and return to the owning editor.

The first version supports Posts, Pages, content Templates, and Site Templates. Header/Footer tasks remember their region. A document must be saved before tasks can be attached. Tasks are not blocks and do not enter document versions or public rendering.

## Workflow

- Statuses: Open, In progress, Ready for review, Done. Assignment, priority, and due date are optional workflow choices (priority defaults to Normal).
- One level of subtasks is supported. Complete every subtask before completing the parent. Reopening a subtask reopens a completed parent.
- Comments are plain text with safely rendered HTTP(S) links. Authors can edit their comments; administrators can moderate them. Activity records creation, status, assignment, and archiving changes.
- Administrators can archive tasks; archiving a parent also archives its subtasks. Restoring a parent does not automatically restore independently archived subtasks.
- Archived records are excluded by default. Administrators retain access to review history for deleted documents; the Open document action explains that the document is unavailable.
- Existing users participate according to document access. Templates require Administrator or Designer privileges. Reviewing a templated Post or Page does not unlock its design.
- There are no emails, notifications, attachments, public pins, or new roles.

## Implementation and rollout

`src/review` owns the Payload collections, access rules, document allowlist, and task UI. `DocumentReviewPanel` in the shared design package owns only the header/panel placement and focus behavior. New document adapters must add their access policy as well as their collection identifier.

The additive `20261011_233000_document_review` migration adds three review tables and their indexes, plus Payload's three document-lock relationship columns. It preserves existing content tables and JSON. Apply it through the established migration workflow **before** deploying this version. Production migration and deployment require a separate authorization; none are performed during implementation.

Validation includes workflow/API access tests, migration up/down preservation checks, editor-panel tests, and browser scenarios covering unsaved content, global navigation, comments, subtasks, and all four editor contexts. Task endpoints use the configured Payload API base. Review data is private and is never included in published page rendering.
