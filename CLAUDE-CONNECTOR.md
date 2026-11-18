# Claude connector (read-only)

Lets Claude (claude.ai, desktop, mobile) read SoE budget request records from QuickBase
through this site. Claude never sees the QuickBase token; data stays in QuickBase and is
only passed to Claude in answer to a tool call by an authorized user.

- Connector URL: https://mitsoeservices.netlify.app/mcp
- Sign-in: MIT Okta session (existing SSO) + consent page. Only users with a school-wide
  **admin** grant in the site's access policy can connect; the check is repeated on every
  request, so removing a grant cuts access immediately.
- Tools: `list_budget_requests`, `summarize_budget_requests` (table br8dehttq). No write tools.
- Tokens: AES-256-GCM sealed with a key derived from SESSION_SECRET (no new secrets).
  Access 1 h, refresh 30 days, codes single-use (Netlify Blobs `mitsoeservices-mcp-*`).
  Rotating SESSION_SECRET revokes every connector token (and every web session).
- Only Claude's callback URLs (claude.ai / claude.com `/api/mcp/auth_callback`) are accepted.
- Every tool call is logged with the MIT login in the Netlify function logs (`mcp`).
- Code: src/mcp-auth.mjs, src/mcp-server.mjs, netlify/functions/mcp*.mjs; tests: mcp-connector.test.mjs.
- Release: `node .runtime/mcp-connector-release.mjs` from the laptop checkout.
