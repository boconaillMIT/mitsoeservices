# SoE HQ RCT review

`/soe-hq/rct-review` is the FY27 Round 2 review workspace under SoE HQ.
RCT Read users can view proposals and download the review workbook;
RCT Write users can save reviews and upload revisions. RCT Managers can also manage RCT access. RCT grants do not grant school or unit finance access. School administrators retain RCT management access.

Proposal metadata, Dropbox links and shared reviews live in the MIT QuickBase
`HQ RCT Reviews` table identified in `src/rct-tables.json`. Each proposal has a
stable `FY27-RCT2|<lead>` key. Saves check a revision UUID and use QuickBase's
native `update_id` to reject concurrent changes without overwriting colleagues.
The original import does not infer awards, decisions or funding contributions.

PDFs and the source workbook remain in Dropbox. Authenticated proposal and source
workbook routes redirect to the corresponding Dropbox links; Dropbox controls
access to those links. No documents are uploaded to Netlify Blob storage.

Excel downloads fetch the source workbook from Dropbox in memory, verify its
imported SHA-256 fingerprint and fill it from the current QuickBase reviews.
The export preserves the original columns and styles, includes the additional
approved proposal, and replaces external workbook dependencies with source
values and local funding formulas. A changed Dropbox workbook must be reconciled
and re-imported before exporting. Offline Excel changes do not update QuickBase.

Only saved reviews are included in downloads. Unknown amounts stay blank and
confirmed zero amounts stay numeric zero. Local support is School + Department +
PI and Other funding; central support needed is the proposed award less local support;
assigned funding includes the six active funding sources. The page flags funding gaps
and excess contributions while permitting draft reviews to be saved.

Each proposal can also have a separately stored preliminary PDF review in source
metadata. These notes assess the October 29 call's criteria, identify supporting
evidence and questions, and cite the supplied PDF pages. They do not populate the
human decision, award, contribution or review-note fields. Visually verified PDF
budget discrepancies are recorded in source notes; the original workbook total
is retained in metadata when corrected or left unverified.

The funding-commitments tab totals saved reviews marked `Support` or `Partial
support` by default. Other scopes and grouping by proposal, primary department
or proposal school/area are available. Joint affiliations stay in one group so
the totals cannot double-count an award. These affiliation groups do not assign
costs between joint payers. Missing contribution values stay unknown, including
entry counts in the displayed totals and the view's downloadable CSV. A zero
entered by a reviewer remains a known numeric zero. The shared calculation
module is `public/rct-model.mjs`, re-exported for the backend from `src/`.

The Netlify function is `rct-review`; its entry point retains request bodies for
same-origin JSON writes. Static assets contain no proposal data or Dropbox links.
Use the project's guarded release process for changes. Release/import scripts,
source snapshots and receipts stay in ignored `.runtime/`; real documents and
financial data must not be added to tests or committed as public assets.

Review improvements (November 2026):
- Invite reviewers is a dedicated RCT-write page at `/soe-hq/rct-review/invite`, with per-proposal assignments to Paula Hammond (`hammond`), Hamsa Balakrishnan (`hamsa`), and Desiree Plata (`dplata`). Assignments are stored in the existing QuickBase review JSON and preserved when older clients omit them. They do not grant website or finance access. `/soe-hq/rct-review/my-review` filters assignments for the signed-in reviewer and marks a proposal reviewed when that reviewer has a named 1–5 score; clearing a score reverses completion. Writers can preview other queues without editing as that person. Invitations download as unsent `.eml` drafts in one ZIP, one per assigned proposal, with all selected recipients, two separate CC recipients, Dropbox links and My review links. The website sends no mail and requires no Microsoft registration.
- Overall priority remains a separate HQ entry. Beside it, the website shows the mean of named reviewer scores, the number of reviews counted, and the proposal rank among scored proposals. Lower means rank higher; exact ties share a rank. Unsaved edits are labelled as a preview, and saved review statistics refresh every 30 seconds without replacing unsaved form values. Every reviewer name is editable, and Clear name and score removes those values while preserving comments and their earlier attribution. Cleared or unnamed scores do not count. Successful saves show a five-second confirmation and highlight the last-saved attribution.
- Proposal actions remain visible while scrolling. The primary PDF link follows the saved final proposal, with the original retained in Proposal versions. RCT writers can prepare editable reviewer invitation emails with a proposal-specific website link, the saved PDF link, and an Eastern-time deadline picker defaulting to November 23, 2026 at 5pm. The Dean recipient option uses “We would appreciate” instead of “Dean Hammond would appreciate.” Email drafts open in the sender’s mail app; no email is sent and no access is granted by the site.
- Six reviewer slots: Hammond, Balakrishnan, Plata, Solomon, and two self-named reviewers. Need priority rankings are 1 (highest priority) through 5 (lowest priority), or blank, with separate comments. The existing internal `grade` storage key is retained so saved scores are unchanged.
- Overall priority is an optional positive integer (1 is highest). Graduate-student funding is unknown until the checkbox is set; saved false remains distinct from unknown.
- Central funding always calculates Provost and EVPT at a rounded third of the proposed award, or the requested total when no award is entered. The former manual central-funding mode is retired. School target is one sixth; School, department and PI amounts remain explicit editable contributions. The local residual absorbs rounding cents.
- Original PDFs remain in Dropbox. Each PDF upload (maximum 3 MB) creates an independent record in the MIT QuickBase proposal-version table. No files are stored in Netlify Blobs. Readers download through the RCT-authorized endpoint; Dropbox permissions still apply to original-source links.
- A final-version pointer is saved with the review revision. The server verifies uploaded final versions belong to the proposal. No document versions are deleted or replaced.
- Workbook overview collects saved need priority rankings, overall priority, grad flags, funding totals and comments in department course-number order. The Excel download retains its original columns and adds a Review details sheet. Offline edits do not sync back.
- Changed shared/reviewer comments retain prior text in server-managed note history. Incoming clients cannot erase that history. Existing fields omitted by older clients are retained, and atomic QuickBase update_id protection remains in place.
- Before releasing the separate-permission change, inspect the production policy. After publishing, preserve existing school Read/Write reviewers through explicit RCT grants without altering their finance grants. Never infer MIT logins from reviewer display names.

Funding correction: Provost and EVPT are always calculated as a rounded third each. The proposed award is the calculation base when present (including zero); otherwise use the requested total. No award or support decision is inferred from that fallback. Only SoE, department and PI contributions are entered manually. VPR is excluded from active funding, UI, CSV and Excel calculations. Legacy stored VPR values remain preserved for compatibility and cannot be changed by new saves. M in the original Excel layout now describes the calculation basis, preserving all later note columns. Funding shortfalls and overages remain nonfatal warnings.

## Named local funding contributors

Provost, EVPT and SoE funding names remain fixed. Each proposal can independently rename the Department, PI and Other contribution fields. Names and amounts are saved together in the existing QuickBase Review JSON under the same revision checks. Old reviews retain their original Department and PI values and start with an empty Other amount. Older open forms cannot clear the new fields by omitting them.

Local funding includes all four local slots. Funding commitments and CSV columns group named contributors across local slots, so a department entered in the former PI slot is not reported as PI funding. The workbook preview identifies each local contributor beside its amount. Excel retains the original note columns and appends Other funding and the three contributor names in W through Z; allocation formulas include Other funding. Retired VPR history remains preserved and excluded.

## Comment attribution and supporting attachments

New or edited shared review notes and reviewer comments receive a server-generated saved timestamp and the signed-in editor’s Kerberos ID. Each text field keeps its own stamp; unrelated funding or ranking saves do not change it. Dates display in America/New_York with a time-zone abbreviation, including in Excel. Client-supplied stamps are ignored. Replaced text retains its prior known attribution in note history. Legacy text remains unstamped until changed rather than acquiring an inferred author.

Supporting attachments can be uploaded separately from proposal versions and are stored in the existing MIT QuickBase file table under a support namespace. They cannot be selected as final proposals. RCT readers can list and download, writers can upload. PDF, EML, MSG, DOCX, XLSX, TXT, PNG and JPEG files up to 3 MB are supported; filenames, decoded content, signatures, payload sizes and proposal ownership are checked. Files download as attachments with no-store, nosniff and sandbox headers. Uploads retain the signed-in uploader and timestamp, never replace existing files, and do not save or discard pending review text.
