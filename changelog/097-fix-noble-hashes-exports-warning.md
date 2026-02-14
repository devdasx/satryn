# 097 — Fix @noble/hashes Exports Warning

## Overview
Suppressed the Metro bundler warning: `Attempted to import the module @noble/hashes/crypto.js which is not listed in the 'exports' of the package`.

## Root Cause
`@noble/hashes` uses the `exports` field in package.json to declare subpath exports (e.g., `./crypto`, `./sha256`). Metro bundler does not resolve package exports by default, so it falls back to direct file resolution and emits a warning even though the file exists.

## Fix
Enabled Metro's package exports resolution by setting `unstable_enablePackageExports = true` in `metro.config.js`. This tells Metro to respect the `exports` field in package.json, which properly maps `@noble/hashes/crypto` to `./crypto.js` for the default (non-Node) condition.

## Files Changed
| File | Changes |
|------|---------|
| `metro.config.js` | Added `config.resolver.unstable_enablePackageExports = true` |
