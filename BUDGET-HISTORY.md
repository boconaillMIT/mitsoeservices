# Three-year history in the Dean’s briefing

Each individual budget unit page displays the selected fiscal year alongside its two prior years. For FY28 this is FY26, FY27 and FY28. The scorecards replace the previous two-year view; editable briefing notes remain independent and unchanged.

Matching asks now occupy aligned rows with one column per year. Clear description aliases and request families align changes in quantity and wording; each source description and separate line remains visible. Distinct courses and broader staff bundles are not merged into earlier narrower requests. Unknown TBA entries remain separate by year. Missing matches are not interpreted as zero or rejection. Changes in ask amount appear when each adjacent year has one priced request in the row. The line-item comparison is the default; the Year view button switches to the year scorecards, with a button to return. Saving a recommendation preserves the selected perspective, and printing includes the active perspective only.

Historical requests and recorded approved funding come from the QuickBase budget request table. Each year and request shows SoE, Provost and any recorded SCC or unresolved-funder amounts. These are recorded allocations, not evidence of cash transfers. Current HQ draft decisions are kept separate.

Initial decline amounts are labeled separately from final declines. Removed requests retain that distinction. Missing figures and years remain unknown or “No record”; they are never silently converted to zero. Unpriced requests make the displayed ask total incomplete.

The backend calculates two unit-filtered historical years in `recentBudgetOutcomes` in `src/budget-hq.mjs`. The reusable renderer and `budgetComparison` in `public/budget-history.mjs` add the current year from current request lines and HQ recommendations. Current asks show requested funding offices, with recommended support and proposed payer shares labeled separately from historical awards. Saving a current decision immediately refreshes its scorecard. No actual unit data is embedded in public assets. Existing unit authorization applies to all three years.
