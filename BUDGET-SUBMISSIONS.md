# Revised budget submissions

Revisions live in MIT QuickBase, in the existing request table's `Workbook Source JSON` field. The original `sources` array remains an immutable workbook provenance snapshot. An append-only `submissions` array stores dated memo revisions alongside it; no financial values or source documents are checked into Git.

Each revision contains schema, unit, fiscal year, document basename, SHA-256, revision date, request-specific context, summary facts and fund histories. Fund figures retain their source classification, rounding and actual/projected distinction. Historical wallet snapshots and canonical approval fields are never replaced by memo forecasts.

The budget unit page exposes the latest revision for that unit and cycle. Source context also appears on request lines and in the Explorer; cycle source captions identify revised documents. Memo fund series are displayed from two years before the budget year onward. The stored source preserves all supplied years.

Full unit-finance readers can retrieve their own revision through `unit-data?unit=<unit>&action=submission`. School-wide readers can see each selected unit's forecast context in the wallet comparison. Neither view incorporates memo forecasts into account balances, combined wallet totals or reserve calculations. Budget-only department readers receive the outlook on their authorized budget page without gaining wallet access.

The wallet's optional revision lookup runs after its main loader. A missing revision or unavailable lookup cannot stop the wallet. Server-side lookup caching is limited to one minute. All endpoint access checks precede retrieval; source metadata is validated and escaped before display.

Data updates must back up the current records, edit only the intended request/source fields using QuickBase `update_id`, preserve the Dean's notes and HQ decisions, and verify unchanged amounts and approval fields. Briefing additions use existing optimistic-concurrency saves and record their date/time and Kerberos actor.

## Dean briefing wallet extract

Every full-finance budget unit briefing starts with the published GIB carryforward and expendable-balance history charts, before request comparisons and notes. The extract reads the protected unit wallet directly, independently of reserve calculations and submission forecasts. Failures leave a visible status and retry action. Department-only budget grants do not gain wallet access. The extract is included when printing. Browser release checks cover MechE first, all real academic units, placement, retry, re-rendering and finance-access restrictions.


Full submission files are stored in the dedicated HQ Budget Submission Files QuickBase table configured by src/budget-document-tables.json. The protected budget-documents function lists and proxies these files with the same authorizeBudget check as the unit briefing, including read-only budget:<unit> grants. Each cycle/unit/SHA256 key is unique; files are immutable and verified on download. The top briefing link opens the latest primary submission; supporting files and originals remain alongside it. PDF copies preserve the original source documents. No attachment bytes or private local paths belong in Git or public assets.

Faculty hiring slots (Faculty TBA category or descriptions beginning TBA/numbered TBAs) are outside the budget-ask cycle. The site excludes them from HQ requests, historical comparisons, totals, counts, CSV, Explorer and reserve request comparisons, while retaining the original QuickBase records. Teaching-assistant requests and other costs with unspecified details remain budget asks.
