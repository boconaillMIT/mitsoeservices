# Revised budget submissions

Revisions live in MIT QuickBase, in the existing request table's `Workbook Source JSON` field. The original `sources` array remains an immutable workbook provenance snapshot. An append-only `submissions` array stores dated memo revisions alongside it; no financial values or source documents are checked into Git.

Each revision contains schema, unit, fiscal year, document basename, SHA-256, revision date, request-specific context, summary facts and fund histories. Fund figures retain their source classification, rounding and actual/projected distinction. Historical wallet snapshots and canonical approval fields are never replaced by memo forecasts.

The budget unit page exposes the latest revision for that unit and cycle. Source context also appears on request lines and in the Explorer; cycle source captions identify revised documents. Memo fund series are displayed from two years before the budget year onward. The stored source preserves all supplied years.

Full unit-finance readers can retrieve their own revision through `unit-data?unit=<unit>&action=submission`. School-wide readers can see each selected unit's forecast context in the wallet comparison. Neither view incorporates memo forecasts into account balances, combined wallet totals or reserve calculations. Budget-only department readers receive the outlook on their authorized budget page without gaining wallet access.

The wallet's optional revision lookup runs after its main loader. A missing revision or unavailable lookup cannot stop the wallet. Server-side lookup caching is limited to one minute. All endpoint access checks precede retrieval; source metadata is validated and escaped before display.

Data updates must back up the current records, edit only the intended request/source fields using QuickBase `update_id`, preserve the Dean's notes and HQ decisions, and verify unchanged amounts and approval fields. Briefing additions use existing optimistic-concurrency saves and record their date/time and Kerberos actor.
