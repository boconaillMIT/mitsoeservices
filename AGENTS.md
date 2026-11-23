# MITSOEServices — handoff for coding agents (Codex / ChatGPT)

Read this before changing anything. It describes how the site is built, where things live, how
releases work, and the mistakes already made once. It contains no secrets and no MIT data.

## 1. Data rules (MIT information protection)

- MIT classifies **budgets, financial account numbers, salaries and personnel information as Medium
  Risk**; SSNs, HIPAA and FERPA records as High Risk (https://infoprotect.mit.edu/risk-classifications/).
  MIT credentials with access to Medium/High data are High Risk.
- Only put Medium Risk data into an AI tool that MIT licenses for it. Confirm your ChatGPT Enterprise
  workspace is MIT-licensed before sharing real budget figures (ask ai-guidance@mit.edu if unsure).
- Never paste tokens, passwords or the contents of `.secrets/` into chat.
- Never commit `.secrets/`, `.env*`, `node_modules/`, or anything in `.runtime/` except the release
  scripts already listed in `.gitignore`. `.runtime/` holds data snapshots and logs.
- Tests use made-up data only. Keep it that way.
- Open question for IS&T (security@mit.edu): the site is hosted on Netlify and some features still
  store encrypted data in Netlify Blobs (unit files, account review notes, access policy).

## 2. What the site is

- **MIT SoE Services**, https://mitsoeservices.netlify.app, Netlify site ID
  `d5648481-35ee-4894-913c-348262857b35`.
- Static pages in `public/`, server code in `src/`, thin Netlify Functions (v2) in
  `netlify/functions/`, routes in `netlify.toml`.
- Sign-in: MIT Okta (`src/mit-sso.cjs`). Access policy: `src/policy.cjs` + `src/access.cjs`
  (roles per scope: `limited_read`, `limited_write`, `read`, `write`, `admin`; scope `school` = SoE HQ).
- Data flows: MIT systems → QuickBase (realm `mit.quickbase.com`) → the site reads and sometimes
  writes via the token in `NIMBUS_QB_TOKEN`. QuickBase is the system of record.

### QuickBase (app `br8deedpt` unless noted)
| Table | ID | Used by |
|---|---|---|
| Budget requests (all fiscal years) | `br8dehttq` | Budget Explorer, Reserves, Budget HQ request lines |
| HQ Budget Decisions | `bwh2kuxge` | Budget HQ decisions per request line |
| HQ Dean Briefing | `bwh2ku2jt` | Dean’s briefing (Talking points, Background, Questions to ask, Recommendation) |
| HQ Budget Units | `bwh2ku5cz` | Documents folder link (MIT Google Shared Drive) per unit and cycle |
| HQ Budget Change Log | `bwh2ku68i` | Append-only record of every HQ change |
| Account catalog (other app) | `br2xvsvpw` | Account review |

The HQ table IDs are in `src/budget-hq-tables.json`. Fields are found **by name**, see `FIELDS` in
`src/budget-hq-qb.mjs`. `.runtime/create-budget-hq-tables.mjs` created them (safe to re-run).

## 3. Main features and files

| Feature | Address | Code |
|---|---|---|
| SoE HQ landing | `/soe-hq` | `src/service-hub.mjs` |
| Budget section, cycle roll-up, unit pages | `/soe-hq/budget`, `/soe-hq/budget/fy28`, `/soe-hq/budget/fy28/<unit>` | `src/budget-hq-pages.mjs`, `src/budget-hq.mjs`, `src/budget-hq-qb.mjs`, `public/budget-hq.js/.css` |
| Budget Explorer (admin) | `/soe-hq/budget-explorer` (+ `-legacy`) | `src/budget-explorer.mjs`, `public/budget-viz.js/.css`, `public/budget-model.mjs` |
| Reserves vs. spending (admin) | `/soe-hq/reserves` | `src/reserves.mjs`, `public/reserves.js/.css` |
| Main menu | every page | `src/navigation.cjs` (SoE HQ → Budget → FY28 budget cycle, school-wide users only) |
| Claude connector (remote MCP) | `/mcp`, `/mcp-oauth/*`, `/.well-known/oauth-*` | `src/mcp-*.mjs`, `netlify/functions/mcp*.mjs`, `CLAUDE-CONNECTOR.md` |

Budget HQ access: view = school-wide `read` or above, or an explicit `budget:<unit>` read-only grant for that department only; decide/edit = school-wide `write` or above. Department-only viewers receive no school-wide totals, peer reserves, unit-finance or RCT access. See `BUDGET-ACCESS.md`.
HQ decisions are deliberately **not** written to the budget table’s “Approved” fields (those feed the
Explorer’s history). Unit keys: `aeroastro, be, cheme, cee, eecs, imes, idss, dmse, meche, nse`,
plus labs/centers in `src/units.cjs`; department names map via `src/unit-name-mapping.cjs`.

## 4. Local setup (Windows laptop)

- Working folder: `C:\Users\oconaill\Documents\ChatGPT\Data Warehouse\netlify-space`
  (a git checkout of the private GitHub repo `boconaillMIT/mitsoeservices`, branch `main`).
- Tools: **Node 22+**, **Git for Windows** (run from PowerShell; Cygwin is not needed),
  `npm install` for `node_modules` (includes `netlify-cli`).
- The folder is owned by the Windows account `CodexSandboxOffline`, so git needs once:
  `git config --global --add safe.directory 'C:/Users/oconaill/Documents/ChatGPT/Data Warehouse/netlify-space'`
- Netlify login token: `%APPDATA%\netlify\Config\config.json` (`npx netlify login` refreshes it).
- Deployment secrets: `.secrets/deployment-env.bin`, encrypted with Windows DPAPI, readable only by
  this Windows login. Scripts decrypt it with `dpapi()` from `.runtime/deployment-transfer.mjs`.
  The live site’s secrets are Functions-scoped environment variables on Netlify.
- Usual loop: `git pull` → change → `node --test` → commit/push → run the matching release script.

## 5. Releasing (read carefully)

Netlify is **not** linked to GitHub. Releases run from the laptop with a guarded script in
`.runtime/` (latest: `.runtime/budget-hq-qb-release.mjs`). Copy the latest one for a new release
and adjust `changed` (public files that change) and `ADDED` (new function names). Each script:
1. runs the relevant tests;
2. copies every public file from the **current production deploy**, replacing only `changed`;
3. deploys a **draft** and checks the function list equals production + `ADDED` and other public
   files are byte-identical;
4. publishes with a **`--prod` deploy of the same folder**, then checks sign-in redirects, 401s on
   data endpoints and key pages;
5. restores the previous deploy automatically if any check fails, and writes a receipt.

Budget briefing release invariant: for every user with wallet access, keep the published GIB carryforward and expendable-balance history charts at the top of the Dean's briefing, before request comparisons and notes. Keep the extract when printing, switching history views, and saving decisions. Budget-only department grants do not gain wallet access. Any release touching budget or wallet UI must browser-check this placement using the actual staged/public assets and fictional data, including MechE first, other wallet-backed units, loading failure/retry, and restricted permissions. Do not remove the extract as part of a layout or memo update.

Budget submission release invariant: keep the full-submission link at the top of each unit briefing when files are available. Submission bytes belong in the dedicated QuickBase file table, never public assets or Git. Recheck the same budget unit permission on every list and download request, including copied links and revoked grants. Browser-check top links for all units with published materials, scoped viewers, failed loading/retry, and preservation of the wallet extract.

Never promote a draft via the restore API: drafts lack production environment variables, which
caused a 503 once. Long uploads need generous timeouts (scripts allow 20 minutes, with retries).

## 6. Gotchas already hit

- **Netlify passes the original address to rewritten functions.** `/soe-hq/budget/fy28/eecs` arrives
  as that path, not as the `to = ...?cycle=:cycle&unit=:unit` query. Parse `event.path` first, query
  second (see `budget-hq-pages.mjs`, `unit-page.mjs`).
- **`eventFrom()` in `src/http.mjs` does not include the request body.** Function wrappers that accept
  writes must set `event.body = await request.text()`.
- **Writes must be same-origin JSON:** check `Origin === APP_ORIGIN` and `Content-Type: application/json`.
- **QuickBase timestamps:** the JSON API reports Date Modified to the second, the XML API to the
  millisecond. Compare versions at whole seconds (`secondsVersion` in `budget-hq-qb.mjs`); use the XML
  API’s `update_id` on `API_EditRecord` so a concurrent change is never overwritten.
- New HQ rows carry a unique `Key` (`FY28|unit|item`) so duplicate creation fails.
- Values used in QuickBase `where` clauses are validated (`SAFE` regex) to prevent query injection.
- `git pull` once said “no tracking information”: run `git branch --set-upstream-to=origin/main main`.
- `node --test` has **13 pre-existing failures** unrelated to recent work (SSO tests needing the
  `jose` package installed, and `resource-codepage.test.mjs` needing an external path). Compare
  against that baseline; do not “fix” them by deleting tests.

## 7. Open items

- **Provost roll-up**: format not yet decided; the cycle page has a CSV export of all lines meanwhile.
- **Documents**: create the MIT Google Shared Drive (folder per unit), share it with HQ (editors) and
  the Dean (viewer), and paste each unit’s folder link on its page.
- **FY28 requests**: import into table `br8dehttq` with QuickBase’s own import (Add new records);
  `Department` names must match `src/unit-name-mapping.cjs`.
- **Claude connector**: no longer needed. Remove the `mcp*` functions, routes and `CLAUDE-CONNECTOR.md`
  in one guarded release (the release script’s function-list check must expect them to be removed).
- **IS&T review** of Netlify hosting and Netlify Blobs storage (see section 1).
