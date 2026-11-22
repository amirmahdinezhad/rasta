# Local builds and GitHub releases

Build locally and distribute the approved artifacts through GitHub Releases.
Use the public `amirmahdinezhad/rasta` repository. GitHub Actions checks source
on Apple Silicon and Intel with read-only permissions.

## Development

Start UI work using `npm run preview:manager`. The browser uses simulated
connections. Leave the preview running during UI review. Run the language check
and relevant tests. Keep routine changes local until the owner authorizes the
appropriate next step.

Keep all version numbers as they are until the owner explicitly requests a
change. Update the root package and lockfile version and the default manager
version together when authorized. Prepare English `docs/releases/<version>.md`
and review it with the owner. Record the affected surfaces and security review
in `docs/releases/<version>.security.md`. Follow the complete
[security checklist](#release-security-checks). Resolve required
test failures and security findings before packaging.

Run `npm ci` and `npm --prefix ui/manager ci`. Install Gitleaks and Playwright,
including Chromium and WebKit, and set `ARTL_PLAYWRIGHT_MODULE` to the absolute
path to Playwright's `index.mjs`. Use the current Xcode Command Line Tools.
Build the shared host panel with `npm run build:panel-ui` and include its exact
output in the candidate commit. Test preflight via `npm run release:check`.
Its local mode checks an uncommitted panel too.

## Release security checks

Run `npm run security:check`, `npm run test:security` and the complete
`npm run release:check` before packaging the exact release source. Rerun
`security:check` before public publication. Use locked installs
for both npm projects. The security gate audits production and development
dependencies in both lockfiles and scans current Git-visible files and history
with Gitleaks. The history exception identifies a single tracked public key.
Keep signing keys, account files, provider data and local credentials outside
Git. Use disposable apps and synthetic values for inspection and fixtures.

Review the candidate's changes against these boundaries:

- Local WebKit pages and Electron isolated worlds expose only the intended
  actions. Verify navigation restrictions, CSP, bridge sender validation, native
  action allowlists and shape validation. Keep isolated data and preferences
  confined to the selected connection.
- Verify pinned Ed25519 manifests, target/platform/version matching, bounded
  payloads, allowed HTTPS URLs, redirect validation, and checksum rejection.
  Verify public downloads without authentication. Check the bundled fallback and
  reject a downloaded manifest with an invalid signature.
- Inspect font and archive handling, staging directories, permissions, symlink
  and path boundaries, invalid input, cancellation and interrupted jobs. Check
  helper invocations for fixed executable scopes and bounded requests. Keep
  account data and secrets out of subprocess arguments, diagnostics and UI errors.
- Verify trusted host identity and vendor integrity policy, macOS signatures,
  keychain authorization limited to the selected app, explicit Launch, rollback,
  update handoff and restoration. Use the verified native baseline for Codex and
  T3. Follow the same checks for the additional connections in a signed local test build.
- Verify both final DMGs and updater archives, including their single-slice
  Mach-O binaries, code signatures, checksums and the signed manifest entry for
  each architecture. Confirm corrupted artifacts and modified metadata are
  rejected. Compare draft and published downloads against the verified candidate.

Keep reviewed security notes and limitations in `docs/releases/<version>.security.md`
and automated results alongside the candidate. Include the checked commit,
lockfiles, scanner versions, dates, scope, known findings and observed results.
Treat a failed or unavailable required check as a release blocker. Record
owner-performed Library acceptance and the post-publication Stable check
separately. Report conclusions within the verified coverage.

## Build the Apple Silicon release

Build from a clean checkout of the reviewed commit. Set
`ARTL_RELEASE_PRIVATE_KEY_FILE` to the existing key outside Git and
`ARTL_PLAYWRIGHT_MODULE` to the installed Playwright module. Run the build and native Library acceptance on Apple Silicon.

```sh
node tools/build-release.mjs <version>
```

The build runs the complete release gate, downloads the official portable Node
runtime for Apple Silicon and checks the published SHA-256. It builds,
signs and verifies the DMG, the updater ZIP, the full and compact packages
for all eight connections and their matching signed public feeds. The candidate and
evidence are saved under `dist/release/<version>/`. Compare the sizes with a
comparable previous build. The default is ad hoc signing. Configure
`ARTL_CODESIGN_IDENTITY` and `ARTL_NOTARY_PROFILE` together to use Developer ID
signing and Apple notarization.

Send the tested Apple Silicon DMG directly to the owner. The owner replaces Rasta.app,
then keeps each existing host connection until choosing Launch in Library.
The bundled signed connection package works before publication. When manually
moving from a higher-numbered connection, choose **Install bundled Rasta
1.0.0** in its Installation tab. The package is staged and the original host
remains active until the owner chooses Launch.

For direct testing of unreleased adapters, use `tools/local-candidate-build.mjs`
in a disposable copy with `RASTA_LOCAL_SOURCE` pointing to the checked source.
The script verifies the signed bundled test packages and delivers them inside a
local test DMG. Gemini is Apple Silicon only. Keep local test images separate
from the public candidate.

## Native acceptance and publication

On Apple Silicon, the owner verifies the exact DMG and corresponding
update ZIP. Record the manager's discovery, selective download, offline repair,
target-only update, removal and normal operation. For every connection, record
the offered version, package verification, completed installation after Launch,
displayed version and working host. Check a changed host update shortcut
separately.

Store the acceptance JSON outside the repository. Include `version`,
`sourceCommit` and `githubPublicationAuthorized: true`, along with the `darwin-arm64` entry under `platforms`.

- Each platform's `manager` records `sha256`, `dmgSha256` and true observations
  for `discovery`, `selectiveDownload`, `offlineRepair`, `targetOnlyUpdate`,
  `removal` and `appWorking`.
- Each platform's `targets` entry records the compact package
  `sha256` and true observations for `libraryOffersVersion`,
  `libraryDownloadComplete`, `libraryInstallComplete`, `versionDisplayed`
  and `appWorking`. A matching bundled artifact satisfies the download check.

After owner approval of that exact candidate, put its verified source on
public main and run the publisher from its clean checkout.

```sh
node tools/publish-release.mjs <version> <acceptance-file>
```

The publisher reruns security checks, verifies the exact local inputs, creates
a draft and checks the downloaded copies before publication. It independently
downloads and verifies the public bytes and release tag before setting Latest.
Check the anonymous download links in the README and verify Library against
the released feeds on Apple Silicon. Keep prior artifacts available in a
local rollback archive when the owner has explicitly authorized the removal of
superseded GitHub releases.
