# Donation Requests — Phase 1

`/donation-requests` is linked from Services Home and the main navigation beside RCT.
All requesters use the existing MIT Okta session and a valid Kerberos principal.
No other site grant is needed to submit or track the requester's own records.

## Permissions and decisions

`dr` is an independent scope with Read, Write and Manager roles. Ordinary school
or RCT grants never inherit DR review access. School administrators retain access.
DR Managers manage only DR grants unless they have other explicit management rights.
The three authorized initial writers are `olearymb`, `mharris` and `nandi`; these
are provisioned as ordinary editable grants, not hardcoded authorization bypasses.

Validity approval records the signed-in reviewer and timestamp. Financial approval
requires an existing validity approval, a **different signed-in Kerberos**, a
positive approved amount no greater than the request, a cost object and a public
decision message. These rules are enforced on the server, including for admins.
An approval records a decision, not payment. No messages or notifications are sent.

## Intake and history

Drafts may be incomplete. Submission requires identity, department, team affiliation,
purpose, dates/deadline, membership counts, requested amount and basic expense budget.
Requests **strictly over $1,000** also require an itemized budget attachment.
The overall fundraising goal is separate from the specific SoE request.
Self-reported prior funding is separate from the visible historical QB records.
Staff can log an email inquiry on behalf of a named MIT requester; that requester
must sign in as the matching Kerberos before accessing it. Account ownership cannot
be reassigned through the intake form.

QuickBase configuration is in `src/dr-tables.json`. Requests hold revisioned JSON
and immutable-through-the-app history snapshots in the same atomic record edit.
Organizations have stable keys. Files have separate immutable records; only a file
linked into the authorized request can be listed or downloaded. Unlinked uploads
from conflicting edits remain inaccessible and may be cleaned up by administrators.
Uploads are limited to 3 MiB each and 40 per request. Budget attachments accept PDF,
XLSX and DOCX. General support also accepts EML, MSG, TXT, PNG and JPEG. File headers,
canonical base64 and SHA-256 fingerprints are checked; downloads force attachment.

Requester reads are owner-scoped at the database query. Internal correspondence,
notes, historical snapshots and cost objects are excluded from requester responses.
Staff reads require current DR access on every request, including copied download links.
Writes use same-origin JSON, application revisions and QuickBase native `update_id`
compare-and-swap. Key uniqueness prevents duplicate records on creation retries.

Request revisions require reopening or a request for more information, clear prior
approvals, and require review again. Financial amendments preserve validity but clear
financial approval and still require a financial approver different from the validity
reviewer. Previous versions and approvals remain in the history.

## Validation and release

`node --test dr-workflow.test.mjs dr-access.test.mjs dr-store.test.mjs` covers approval
separation, threshold behavior, requester isolation, redaction, revocation, upload
validation and concurrency. Use fictional data only. The full site suite must pass
before release. Browser checks cover intake, required attachment, submission,
independent approvals, requester privacy and mobile layout.

Install runtime dependencies physically in the checkout (`npm ci --omit=dev
--ignore-scripts`); a junction to another checkout can cause deployment tracing to
omit `fflate` and break RCT startup. Check the draft RCT, DR and budget-documents
endpoints for a clean 401 or configuration-related 503 before publishing; 502 is
a failed package/startup check. The local CLI may come from the established tooling
checkout, but the application's runtime libraries must be available in this one.

Follow the existing guarded Netlify release process: preserve current production
public assets, add only `donation-requests.js`, `donation-requests.css`, `dr-model.mjs`
and the new `donation-requests` function. Preserve all other functions. Never deploy
the checkout's public folder wholesale. Add the live DR grants only after publication
because older policy validators do not recognize the new scope.

Phase 2 will add configurable intake and review notifications, handoff alerts,
delivery history and reminders. Phase 1 records workflow events but sends nothing.
