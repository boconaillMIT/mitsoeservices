# SoE HQ RCT review

`/soe-hq/rct-review` is the FY27 Round 2 review workspace under SoE HQ.
School-wide readers can view proposals and download the review workbook;
school-wide writers can save reviews. Unit-only and limited access do not grant access.

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
