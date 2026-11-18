# DAF wallets and scoped permissions — prepared for testing

All 10 academic wallets published on 2026-10-22 in deployment 6ada64306a093a8747000fb2.
All 45 automated tests pass. Production policy migration was verified with Brian
and Julie as the designated administrators. Brian subsequently added Wafa
(`wafa2527`) with BE read-only access; that administrator-granted permission was
preserved through the routing correction. NSE/BE path parsing takes precedence
over query parameters, and direct function URLs enforce the same authorization.

Routes: `/admin` and `/units/<scope>` for aeroastro, be, cheme, cee, eecs, imes, idss, dmse, meche, nse.
Private unit snapshots contain 30,421 verified Quickbase wallet detail records in total.
They are read-only published snapshots, not live Warehouse queries. Source fiscal periods
and publication timestamps are shown in each wallet. No user grants were changed.
All 10 anonymous page requests redirect to sign-in; direct unit-data requests return 401.
Public snapshot/source-path probes return 404.
Authenticated browser verification completed after user-approved session-key persistence
and native Lambda authentication cookie responses were deployed. MIT login opened
the home page with all 10 wallet links; BE balances and account history loaded.
The same signed-in session remained valid across the next production deployment.
The deployment session key is Windows-user encrypted in the ignored .secrets folder;
it is only supplied to Netlify Functions and is separate from Warehouse credentials.
No Pete or Roni account has been created or granted access by this work.

The new policy starts with only `oconaill` and `juliekuk`, both school-wide
administrators. Its migration explicitly resets the legacy five-person allowlist
to those two administrators. Existing audit entries are retained.

Roles: read (view), write (view and permitted data edits), admin (school-wide
access and permission management). Data editing features are not yet connected.
Every new mutation endpoint must call the server authorization helper with its
fixed resource scope and `minimum: 'write'`; UI controls alone are insufficient.

School-wide roles inherit into each unit. Unit roles do not inherit upward or
across units. If someone has both school read and NSE write, they can read all
units and edit NSE. Removing a unit grant does not cancel inherited school access.
Administrators may manage grants; Brian remains a protected recovery administrator; Julie and other administrators
can be edited or removed through the normal grant workflow. Role changes are checked against persistent
policy on every server request, including existing signed-in sessions.

Before publication, test real MIT sign-in for Brian and Julie, role storage and
administrator updates in the target deployment. With a consenting test user,
check NSE-only access, BE denial, school-report denial, read/write enforcement,
direct API URLs, revocation and existing-session downgrade behavior. Automated
unit tests use synthetic accounts, not new real users.

Before connecting financial data, create unit-scoped server data endpoints that
filter records using the authorized scope. Do not send the all-school SharePoint
snapshot to unit browsers or rely on client-side filtering. Data exports must use
the same authorization. Website permissions do not revoke access to files already
downloaded or separately granted in Quickbase or SharePoint.

Reapply Functions-only deployment variables when deploying. Deployment-scoped
secrets from the current release are not persistent site environment variables.

## Next design decision: Warehouse refresh credentials

After wallet publication/sign-in verification, discuss write/admin refresh dispatch,
Warehouse authentication, and optional credential saving versus prompting on every
refresh. No new Warehouse password-storage feature has been implemented. Keep
site role authorization separate from Warehouse identity and credential handling.
The current MIT-connected worker already supports user-bound Windows-encrypted
credentials; avoid introducing browser or hosted-site storage of Warehouse passwords.

## Editable MIT identities (2026-10-23)

Julie is no longer an immutable administrator. Her existing school/admin grant
remains unchanged until an administrator edits it. The admin screen accepts an
MIT Kerberos login or its @mit.edu form and canonicalizes case and whitespace.
Authorization uses only the verified session login, not a user-entered identity
or fallback email claim. Non-MIT email domains are rejected. Access-denied
responses show only the current user's canonical login in plain text.

## Full and limited unit pages (2026-10-23)

Deployment 6adb59367ea7ab63f0d1ab5b passed 52 tests. Home links to
`/academic-units`; each unit has `/full` and `/limited` landing pages. The
`/wallet` route and its data endpoint require full access. The former bare unit
URL now opens the Full access landing page. Limited pages contain no wallet data.

Five roles: limited_read, limited_write, read (unit-wide), write (unit-wide),
admin (unit-wide). Existing read/write/admin grants retain their original full
access. Full roles also cover limited content. School grants inherit into all
units. School administrators may manage all scopes. Unit administrators may
view and change grants and audit entries only within units they administer;
server checks reject cross-unit and school grant attempts. Scope and content
tier checks run before any wallet storage read.

Limited content publishing and financial editing tools are not yet implemented.
Write roles authorize editing only where a feature implements a server-side write
check; they do not add new editing functionality by themselves.
