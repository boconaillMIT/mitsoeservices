# Department only budget viewers

School administrators can assign a budget viewer permission independently for
each department or program, using Manage access. Select an area beginning
**Budget viewer**, enter the MIT login, and save the read-only role. Repeat for
each assigned department. No user grants are created by deploying this feature.

These permissions use `budget:<unit>` scopes in the existing access policy.
They allow only the selected department's budget requests, historical asks,
HQ decisions, briefing fields, change log, document-folder link and department
CSV download. The cycle page is a directory of assigned departments without
school-wide totals. Direct page and data requests are checked on the server
before loading financial data for unassigned departments. All mutations remain
restricted to existing school-wide writers and administrators.

Budget-only grants do not grant unit finance, reserve comparisons, school-wide
budget exports, Budget Explorer, RCT access or access management. School-wide
permissions remain additive: remove a person's broad school-wide grant if they
must have only department-specific budget access. Unit and RCT administrators
cannot delegate budget viewer grants; school administrators manage them.

Document links are read from the selected department's saved Google Drive
folder. Google's own sharing rules still apply. The website grant neither
changes Drive permissions nor publishes new submission files. Departments with
no linked folder continue to show that no document folder is linked.

Existing school-wide budget users retain their existing pages and editing
rights. The restricted administrator test view cannot recover real budget
grants through this mechanism. Grant removal applies to the next request.

Tests use fabricated departments and figures to verify grant assignment,
revocation, page and API isolation, read-only enforcement, filtered downloads,
independent RCT/unit-finance permissions and preservation of full HQ access.
