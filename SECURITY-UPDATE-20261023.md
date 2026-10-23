# Security update: 2026-10-23

Node.js 24.22.1 is selected in `.nvmrc` and `engines.node`. This includes the October 21 security patches. Application source behavior is unchanged except for required build integration configuration.

Source: [Node.js October security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

## Verification and limitations

All 94 tests pass on Node 24. Existing Pixi patches apply successfully. Standalone build fails because its ES2017/node14 targets encounter top-level await in participant imports. Participant Vite integration compiles successfully.

Native npm audit: 0 critical, 4 high, 0 moderate, 0 low findings. Counts represent affected dependency packages, not unique CVEs.

Remaining findings are deferred to a separate compatibility/reachability review by 2026-10-30. High findings are not claimed fixed or harmless. Many are inherited from braces/micromatch, test tooling, development servers, or discontinued packages; runtime exposure must be assessed before release.

| Package | Severity | Remediation status | Advisory |
| --- | --- | --- | --- |
| `braces` | high | Requires declared-range/major change | [braces vulnerable to stack-exhaustion denial of service through deeply nested patterns](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| `find-yarn-workspace-root` | high | Requires declared-range/major change | Inherited from vulnerable dependency |
| `micromatch` | high | Requires declared-range/major change | Inherited from vulnerable dependency |
| `patch-package` | high | Requires declared-range/major change | Inherited from vulnerable dependency |

## Verification scenario

Use the pinned Node version. Install from the authoritative lockfile with dependency scripts disabled first, review native/postinstall scripts, and run only those required by the package. Run the documented test/build commands. Repeat the native audit before release. In a preview, exercise the package's normal entry point and check browser/server errors. A successful build does not prove production integration.
