# Forms visual logic designer

Open a Form, then **Logic → Flow designer**. Existing forms retain their current navigation until **Enable graph navigation** is selected and the form is published. Saving a draft does not change a published revision.

## Try the support example

Choose **Create separate example form**, then **Open example form**. This creates a new draft through the normal Forms API; it never replaces the current form. Alternatively, download the editable example and import it into a new form. In the example's Logic tab choose **Run Preview**.

Enter Name and Contact Information, select a Ticket Type, and follow its details screen. Teams includes a question that sets High or Normal priority. Every branch joins Review. Submit validates without saving in preview; in a published form it uses the existing submission endpoint. The email is simulated, followed by Confirmation and End.

## Building a flow

- Add canvases and fields in Build. Select a canvas to configure its named buttons. Button previews open those settings; Try form runs them.
- Canvas nodes reference existing IDs. Renaming a canvas or question keeps connections. Use **Edit canvas** to return to Build.
- Add nodes from the searchable palette by click or drag. Drag a labeled output to an input, or use the selected node's **Connect** selectors. Select nodes to configure them. Delete connections in the inspector; delete selected nodes with the inspector action or Delete key.
- Use pan, zoom, and fit controls to navigate. Node positions save with the form. Preview and logs are session-only and do not dirty the form.
- **Field rules** retains the existing visibility, required-field, formatting, and value rules. Remove legacy Go to canvas rules before enabling graph routing; two navigation mechanisms cannot run together.
- Incomplete graphs can be saved as drafts. The issue list explains missing settings and connections. Enabled graphs must pass validation before publication.

## Capabilities

| Block | Behavior |
| --- | --- |
| Start / Canvas | Initial screen, named events, existing field rendering and validation |
| If / Else | Existing typed condition operators, AND/OR groups, True/False outputs |
| Switch | Ordered first-match cases and Default |
| Set Value | Literal, copied answer, or clear; field answers or session variables |
| Show Message | Message followed by an explicit Continue |
| Submit | Existing entry acceptance; accepted/failure branches; no real submission in preview |
| Email / CMS / HTTP | **Simulated only**, including on published forms; resolved payload shown in preview log |
| End | Final confirmation message |

Existing independently configured submission actions still run normally. Simulated graph actions never register jobs, deliver email, write records, or issue HTTP requests. Do not put credentials in graph settings. Use `{{field_id}}` or `{{variable:name}}` placeholders in simulated action configuration.

## Runtime boundaries

Back truncates the current path to the previously visited canvas. Answers from abandoned paths remain available if the respondent returns, but are excluded from accepted answers and required validation. The server replays bounded button events against the published definition, rather than trusting a client-supplied list of active fields. Conditions cannot read answers from screens not yet visited.

The runtime stops after 100 automatic transitions without user input; sessions are also bounded. Conflicting outputs are errors. Graphs use existing JSON storage, and no database migration is required. Imports remap canvas, field, option and graph-node references together.

This first version keeps execution synchronous between interactions. Set Value assignments are authoritative while their node remains in the active path; use session variables or dedicated calculated values for routing rather than overwriting a question the respondent must subsequently edit. Saved progress restores answers and restarts at Start; it does not resume graph execution. After acceptance, confirmation steps can continue but Back cannot return to previously submitted input. Preview logs are temporary and contain test answers; they are not an execution-history dashboard.

Useful next improvements are graph-assisted connection suggestions, clearer entry-value assignment timing, and selectively enabling existing server integrations. Durable workflows, retries, delayed actions, advanced auto-layout and a new integration framework are intentionally excluded.

## Verification evidence

The framework suite passed 219 tests before the final retry regression was added; the final focused Forms run passed 79 tests. Forms integration passed 61 tests. Production-bundle browser coverage exercises the designer, editable example creation, all four public ticket branches, Back with a changed branch, actual entry acceptance, forged navigation rejection, and the existing Forms editor regressions. The browser harness waits for Payload hydration before resizing the editor.

Client-reported failure transitions can lead to a retry, but never count as acceptance or exempt previously visited fields. Only the existing submission endpoint accepts an entry. The interpreter rejects client-reported success transitions during submission validation.

Authenticated production-bundle testing uses isolated local storage. Live authenticated verification and creating the example in production require an available admin session; the example-creation control creates a separate draft when used from that session.
