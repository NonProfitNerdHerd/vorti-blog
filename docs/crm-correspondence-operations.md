# Receipts and correspondence

Staff can manage templates and prepare documents from the CRM navigation or a contact's correspondence tab. Select the recorded recipient and source gift or membership term, enter issuer details, review the resolved content, then issue it. Issuance retains the template version, recipient details, issuer and recorded balances. It does not create gifts, payments or membership renewals.

Issued documents offer printable HTML immediately. The scheduled CRM processor generates PDFs in the private `WORKSPACE_FILES` R2 bucket. Staff can inspect progress, cancel pending generation, and retry failed or cancelled jobs. Downloads recheck current chapter and record permissions. Unsupported PDF characters leave printable HTML available with a visible generation error.

For a refund or changed recipient information, open issued-document history and choose **Prepare correction**. Review and issue a replacement with current values. Its text names the document it supersedes. The original snapshot and any earlier delivery remain retained. Received money, in-kind descriptions and currencies remain separate; statements do not determine tax eligibility.

## Enabling email

Printing and PDF generation work without email configuration. New delivery remains disabled unless all of these conditions hold:

- The production Worker has `CRM_EMAIL_ENVIRONMENT=production` and `CRM_EMAIL_LIVE_SEND_ENABLED=true`.
- The server secret `CRM_EMAIL_RESEND_API_KEY` contains the authorized Resend API key. Do not enter it in a template, staff sender form or donor record.
- An authorized administrator saves the chapter's Resend sender address, sender name, reply-to address if needed, and provider domain ID under **Email configuration**.
- The domain verification action confirms the domain and sending capability, and the administrator enables the chapter's sender settings. Changing sender configuration or rotating the key requires renewed verification.

The existing protected scheduler uses `FORM_JOB_TOKEN` and the existing five-minute trigger. Its CRM tick performs bounded PDF generation, staged-file cleanup, email dispatch and provider-status reconciliation. Application deployment preserves existing Worker variables and secrets. Development and isolated test bindings disable real delivery.

## Delivery review and recovery

An issued document has one retained ordinary delivery. Staff select a current recorded email address, optionally attach the ready PDF, preview the exact content, and queue that reviewed message. Dispatch rechecks the original staff member's current access, recipient consent, sender configuration and document status.

**Accepted** records provider acceptance; **delivered**, **bounced** and **complained** record provider outcomes. Staff can inspect paginated retained delivery events and refresh status. Reconciliation reads a provider message ID and verifies the sender, recipient, content, timing and unique delivery reference. It never sends another message.

Cancellation before dispatch prevents sending. Cancellation during a network attempt retains uncertainty because the provider may already have accepted the message. A late acceptance remains visible. An unchanged-message retry retains the original payload and idempotency key and is available only while source revisions, consent, access and the conservative retry window permit it.

If the outcome is uncertain, reconcile the provider record before queuing a replacement. An expired uncertain attempt is never automatically resent with a fresh key. Changed recipient or sender details require a reviewed correction and a separate delivery; they do not rewrite the original queued message. A recorded acceptance prevents cancelling or retrying that delivery.

Private staged PDF objects abandoned by interrupted work are removed after the grace period by a bounded, cursor-based sweep. Published issued documents and their private file metadata remain retained. The later import/export retention workflows and bulk correspondence are separate unfinished plan items.
