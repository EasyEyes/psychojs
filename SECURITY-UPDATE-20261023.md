# Security update: 2026-10-23

Node.js 24.22.1 is selected in `.nvmrc` and `engines.node`. This includes the October 21 security patches. Application source behavior is unchanged except for required build integration configuration.

Source: [Node.js October security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

## Verification and limitations

Revalidated on 2026-10-29 with Node 24.22.1 / npm 11.19.1. All 95 tests pass and existing Pixi patches apply. The full standalone build now passes (ESM, IIFE, CSS, and JSDoc). The library no longer imports the participant entry point: EasyEyes registers live session state through configureEasyEyes. A context regression verifies later calibration changes and lazy reader initialization. JSDoc excludes test files and fixes invalid Promise type annotations.

Chromium loaded the standalone IIFE and exposed core.PsychoJS, visual.TextStim, and configureEasyEyes as functions. Expected browser audio autoplay warnings were observed before a user gesture; no library exception occurred. An additional Playwright smoke opened a real PIXI canvas at resolution 0.5, rendered a TextStim, and downloaded calibration JSON using a later change to the registered calibration time; no page exceptions occurred. The browser's favicon request was unrelated to library loading. The current threshold base is integrated in the parent PR. Neither PR is merged.

Native npm audit refreshed on 2026-10-29: 0 critical, 0 high, 0 moderate, 6 low findings. The table below records the historical October 23 findings, which the current registry no longer reports at high severity. Counts represent affected dependency packages, not unique CVEs.

Remaining findings are deferred to a separate compatibility/reachability review by 2026-10-30. High findings are not claimed fixed or harmless. Many are inherited from braces/micromatch, test tooling, development servers, or discontinued packages; runtime exposure must be assessed before release.

| Package | Severity | Remediation status | Advisory |
| --- | --- | --- | --- |
| `braces` | high | Requires declared-range/major change | [braces vulnerable to stack-exhaustion denial of service through deeply nested patterns](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| `find-yarn-workspace-root` | high | Requires declared-range/major change | Inherited from vulnerable dependency |
| `micromatch` | high | Requires declared-range/major change | Inherited from vulnerable dependency |
| `patch-package` | high | Requires declared-range/major change | Inherited from vulnerable dependency |

## Verification scenario

Use the pinned Node version. Install from the authoritative lockfile with dependency scripts disabled first, review native/postinstall scripts, and run only those required by the package. Run the documented test/build commands. Repeat the native audit before release. In a preview, exercise the package's normal entry point and check browser/server errors. A successful build does not prove production integration.
