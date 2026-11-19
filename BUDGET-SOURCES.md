# Budget workbook integration

Budget workbooks are source evidence for the existing budget cycle and history. They are not a separate site section. The old /soe-hq/budget-sources page redirects authorized administrators to Budget Explorer; its navigation and landing-page cards have been removed. Protected snapshot data and worksheet endpoints remain available for maintenance.

FY28 initial requests were imported into canonical QuickBase budget table br8dehttq using QuickBase's native CSV Add New Records import. A unique Workbook Source Key identifies each source line. Workbook Source JSON retains the workbook, worksheet, row, fingerprint, notes, flags and proposed funding split. Future imports must reconcile existing keys rather than create duplicates or overwrite reviewed records. Explicit no-request markers and subtotal rows are not asks. Unspecified amounts stay blank.

The existing /soe-hq/budget/fy28 cycle and unit pages read these canonical records. Working allocations go into request/proposal fields and source context. They do not populate approved funding, declines, or HQ Budget Decisions. Support percentages cannot be saved for an unpriced request until its amount is recorded in QuickBase.

Historical sources are attached to matching existing records as evidence, not appended as additional asks. Matches require the same year and unit plus an unambiguous description or a reviewed unique financial signature. Unmatched and ambiguous rows remain in private snapshots for reconciliation. Differences between workbook versions and saved financial figures are marked in source context; saved figures and HQ decisions are preserved.

Budget Explorer and existing unit history display workbook context beside relevant requests. Approved SCC support is an independent funder, included once alongside Provost, SoE and unresolved funding. Proposed SCC allocations do not count as approvals. Unknown requests are flagged and excluded from dollar totals.

QuickBase table HQ Budget Workbook Sources (bwh4q7wwp, app br8deedpt) retains dated private snapshots for traceability. Originals stay in Dropbox. Workbook SHA-256, worksheet metadata and immutable chunks are verified against a manifest. No real financial figures or account references are embedded in committed public assets.

Relevant files: src/budget-explorer.mjs, src/budget-hq.mjs, public/budget-model.mjs, public/budget-hq.js, public/budget-viz.js and public/budget-explorer.js. src/budget-source-model.mjs contains workbook layouts used during reconciliation. budget-integration.test.mjs uses fabricated values to check proposed versus approved funding, SCC, unknown amounts, source rendering, canonical loading and support validation.

Follow the guarded release process in AGENTS.md. Preserve current public assets and the function set, verify a draft, and publish a fresh production deploy with authentication checks and rollback. Do not deploy concurrent RCT edits from another checkout.
