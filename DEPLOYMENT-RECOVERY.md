# Deployment recovery notes — 2026-11-11

The current production deploy is `6af4b5eee0c0aad01eb5aada`.

The /my-unit redirect loop was caused by missing runtime libraries. Diagnostic logs showed a present session cookie followed by ERR_MODULE_NOT_FOUND. Windows pnpm symlinks in the function ZIP pointed at absolute C: paths, which do not exist on Netlify. Build release dependencies as real files with pnpm's hoisted node linker, rather than copying the workspace's symlinked modules. Explicitly retain jose and @netlify/blobs in the function package. Inspect the ZIP for actual package.json and implementation files at the paths used by the bundled function.

The repaired function was built from `.runtime/entry-release`, using `pnpm --dir .runtime/entry-release install --config.node-linker=hoisted --ignore-scripts --no-frozen-lockfile`. Authentication and permission logic were unchanged. A normal authenticated browser verified that /my-unit reaches Services Home for the school administrator. Anonymous requests still require sign-in.

IMPORTANT: the migration export is missing the wallet-categories backend source. Do not publish all local functions over production. Preserve the current production function digests and replace only the reviewed function; `.runtime/replace-entry.mjs` implements that guarded workflow for my-unit. All 35 other backend functions and public assets were preserved. Restore complete current source before attempting a full release.

Deployment keys are encrypted for the current Windows user in `.secrets/deployment-env.bin`. Never print them or put them in public assets. Existing encryption keys and access grants must be preserved.
