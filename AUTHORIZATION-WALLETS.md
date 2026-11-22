# Authorization summaries and wallet comparisons

- `/my-authorizations` and the signed-in home screen describe the current user’s permissions. Direct grants and inherited school-wide access are distinguished. RCT remains separate; explicit budget viewer grants remain department scoped.
- Manage access supports a read-only person lookup. School administrators see all areas; unit/RCT managers see only areas they administer. Lookup never changes grants.
- RCT’s main page lists its effective audience, including school administrators, using the same authorization policy as its protected endpoints.
- The SoE wallet comparison requires school-wide full finance read access. Unit-only and budget-only readers cannot fetch it. It returns resource history and snapshot totals without account identifiers.
- The combined wallet covers the ten real academic units. Fictional, other-unit and separately managed wallets are excluded. A combined amount requires complete compatible snapshots; unavailable figures are never zero-filled.
- Department-controlled histories are compared by resource; Pool A payout is unit-wide. Individual source blanks are excluded and counted, matching existing wallet totals; entirely blank years remain unavailable. Relative change is `(last − first) / abs(first)`. A zero baseline has no percentage comparison. Earliest/latest matching actual fiscal years and reporting-period sets are used. Projected years are excluded from trend prompts. Financial improvement is a discussion prompt, not an assessment of uncommitted resources.
- No financial records, notes, recommendations or permission grants are changed by these read-only features.
