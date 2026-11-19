# Budget workbook sources and needs

`/soe-hq/budget-sources` is a school-administrator-only analysis view. Links appear under SoE HQ → Budget and in Budget Explorer. The page, data endpoint, and worksheet endpoint all require the same administrator permission.

The QuickBase table **HQ Budget Workbook Sources** (`bwh4q7wwp`, app `br8deedpt`) holds dated source snapshots. Originals stay in Dropbox. Financial figures, source notes and account references are not included in public assets or committed source. This feature does not write to budget requests, approved funding fields, or HQ decisions.

Each snapshot has a workbook SHA-256, worksheet metadata and immutable JSON chunks. A manifest is published only after all chunks are read back and verified. The reader checks chunk hashes, counts and duplicate rows before returning data. Older snapshot chunks remain available when a newer manifest is imported.

Explicit workbook layouts are mapped in `src/budget-source-model.mjs`. Fiscal years in row fields take precedence over tab titles. Parallel working, final and distribution blocks are separate selectable datasets. Subtotals are excluded, missing money remains null, and saved formulas are not recalculated. TA costs use only the unit cost block; potential source-account balances remain available in Source worksheets and are not added to TA commitments. Distribution source-account references are retained as text and do not establish that a transfer was posted.

Comparison with the existing QuickBase feed is a reconciliation aid for the same year and units. It does not match individual requests or resolve conflicting versions. Working allocations compare requested amounts only; SCC has no corresponding canonical feed field. Filtering text or source flags disables comparisons of incomplete unit totals. Source worksheet values and formula text can be inspected separately, including sheets outside the normalized layouts.

The browser supports year, version, unit and source-flag filters, funding totals, source notes, account references and CSV downloads. Tests use fabricated values only: `node --test budget-sources.test.mjs`.

Release preparation uses `.runtime/budget-sources-stage.mjs`; publishing uses `.runtime/budget-sources-publish.mjs`. The guarded release preserves current production assets, adds only the `budget-sources` function and three public analysis assets, verifies the draft, then creates a fresh production deploy with authentication checks and rollback on failure.
