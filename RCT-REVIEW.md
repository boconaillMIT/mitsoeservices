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
PI funding; central support needed is the proposed award less local support;
assigned funding includes all six funding sources. The page flags funding gaps
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
- Six reviewer slots: Hammond, Balakrishnan, Plata, Solomon, and two self-named reviewers. Grades are 1–5 or blank, with separate comments. No high/low interpretation or grade average is inferred.
- Overall priority is an optional positive integer (1 is highest). Graduate-student funding is unknown until the checkbox is set; saved false remains distinct from unknown.
- Automatic central funding calculates Provost and EVPT at a rounded third of the proposed award. Existing manual amounts stay manual. School target is one sixth; School, department and PI amounts remain explicit editable contributions. The local residual absorbs rounding cents.
- Original PDFs remain in Dropbox. Each PDF upload (maximum 3 MB) creates an independent record in the MIT QuickBase proposal-version table. No files are stored in Netlify Blobs. Readers download through the RCT-authorized endpoint; Dropbox permissions still apply to original-source links.
- A final-version pointer is saved with the review revision. The server verifies uploaded final versions belong to the proposal. No document versions are deleted or replaced.
- Workbook overview collects saved grades, priority, grad flags, funding totals and comments in department course-number order. The Excel download retains its original columns and adds a Review details sheet. Offline edits do not sync back.
- Changed shared/reviewer comments retain prior text in server-managed note history. Incoming clients cannot erase that history. Existing fields omitted by older clients are retained, and atomic QuickBase update_id protection remains in place.
- Before releasing the separate-permission change, inspect the production policy. After publishing, preserve existing school Read/Write reviewers through explicit RCT grants without altering their finance grants. Never infer MIT logins from reviewer display names.
