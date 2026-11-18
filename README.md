# MITSOEServices on Netlify

This is the Netlify-specific project. The Python service in ../sync_app is the earlier MIT-server implementation and is not deployed here.

The Netlify project belongs to team boconaillmit (displayed as MIT AeroAstro), site ID d5648481-35ee-4894-913c-348262857b35.
The public landing page contains no warehouse credentials, tokens, or financial records.

## Deploy

After authorizing Netlify's official CLI:

```sh
npm install
node --test
npx netlify deploy --site d5648481-35ee-4894-913c-348262857b35 --prod --dir public --functions netlify/functions --no-build
```

The site-ID flag deliberately targets the already-created team project.
The CLI login token is stored by Netlify's tooling in the user's local configuration, not in this source tree.
Never add it to package.json, netlify.toml, or frontend code.

## Connectivity test

The Test connectivity button invokes /.netlify/functions/connectivity.
The function uses fixed destinations warehouse.mit.edu:1521 and api.quickbase.com:443.
It only tests TCP reachability, does not authenticate, does not run SQL, and sends no application credentials.
A successful TCP test is not proof that Oracle sign-in or encryption will work.

## Remaining implementation

1. Verify warehouse reachability from the deployed Netlify function.
2. Configure authenticated colleague access, with the intended Kerberos-username allowlist mapped through an actual identity provider. A browser-supplied username/header is not authentication.
3. Adapt the sync worker to a supported Netlify runtime, including decimal-safe money handling, durable run state, and shared run locking.
4. Configure server-side service credentials; do not move the Python process's local SQLite database into a serverless filesystem.
5. Reconcile the exact extract against the captured Cognos totals before enabling Quickbase updates.
6. Add the requested monthly schedule: the 10th at 02:00 America/New_York. Netlify schedules use UTC; handle Eastern daylight-saving time and ensure one execution per period through durable state.
7. The scheduled trigger must hand off to a background worker when the sync exceeds the scheduled-function runtime limit.

No automatic data synchronization or colleague login is enabled by this initial project.


## MIT SSO integration status

The MIT Touchstone implementation from ../mit-touchstone-sso is integrated with
server-side dashboard and connectivity API protection, encrypted sessions, and
an explicit MIT_ALLOWED_USERS list. Dashboard HTML is kept outside public/.
See SSO-SETUP.txt for required deployment settings and the callback URI.

Twenty automated tests pass. Draft deployment 6ad370b97d5332a91677e7fc was checked:
root/index/dashboard/connectivity fail closed with 503 until configured; source
HTML and the removed ZIP return 404. MIT live login has not been completed:
production has no SSO environment variables and its callback registration is
unconfirmed. Production was not changed by this integration work.

The local Windows Warehouse worker retains its separate local authentication
and credentials. This Netlify integration does not enable remote report dispatch.

## Hosted FY27 report with local execution

The new `/reports` route serves the report page through the same verified MIT
session and account allowlist as the dashboard. It connects to the installed
local worker through a top-level localhost window, using exact-origin
`postMessage` checks, a per-connection nonce, an explicit local Connect button,
and a local CSRF-protected API. No CORS exemptions, browser security flags,
third-party cookies, or local port exposure are needed. The bridge only accepts
the production origin `https://mitsoeservices.netlify.app`; draft URLs cannot
connect to the production-origin bridge.

All financial reads, saved configurations, decimal calculations, and snapshots
stay in the Windows worker. Results travel directly to the user's hosted browser
tab; no report data or source credentials are sent to a Netlify function or Blobs.
The bridge cannot run Quickbase updates. It must remain open, and the user must
have MIT/VPN connectivity. The hosted page checks the current server-side access
policy before each local operation. This hybrid flow replaces the need to port
the financial report backend to a Netlify runtime; sync scheduling remains separate.

Current blocker: Netlify has no configured environment variables for MIT sign-in.
The protected report route fails closed until the approved MIT registration and
SSO settings in SSO-SETUP.txt are completed. Do not publish an unprotected report
shell as a workaround without the user's explicit access-model choice.


## Administrator access management

Added October 17, 2026: /admin is available only to the verified Kerberos accounts
oconaill and juliekuk. Initial permitted users are oconaill, juliekuk, hammond,
kimcs, and afahim. The administrator API supports adding/removing ordinary users,
version checks to prevent overwritten edits, and a bounded change audit.
The two designated administrators cannot be removed through the UI.

Access policy is private Netlify Blobs state, using strong reads and conditional
writes, checked per protected request. Missing or unavailable storage denies
access. Only the currently published deployment uses the production policy
namespace; drafts use a separate preview namespace. No report data or application
credentials are stored in Blobs. The local Windows worker is outside this policy.

Twenty-five automated tests pass. Administrator UI, actual hosted policy storage,
and MIT sign-in still require live verification with the approved MIT registration.
See MIT-SSO-REGISTRATION-REQUEST.txt for a ready-to-forward request (not sent).
