# Codex 26.1027.51404 and T3 Code 0.1.6 compatibility

## Host and download verification

The installed apps were inspected through their bundles and ASAR packages.
Codex at `/Applications/ChatGPT.app` identifies version `26.1027.30824`, build
`22943`; T3 Code identifies version/build `0.1.5`. Both contain Rasta `1.1.12`.
The new vendor apps were downloaded and tested separately. The agent did not
close, replace or install either original app.

The official Codex appcast offers `26.1027.51404`, build `23880`, for Apple
Silicon. The ZIP is 764974997 bytes, with SHA-256
`93993beed5ee52a61147ca973290e2052bb0fa3da117634d571267071720bb5d`.
Its Ed25519 signature passes against the existing vendor key. Strict deep
signature verification confirms the OpenAI identity and Team ID `2DC432GLL2`.
The downloaded bundle and ASAR agree on the version and build; its main entry
remains `.vite/build/early-bootstrap.js`.

The official [T3 v0.1.6 release](https://github.com/pingdotgg/t3code/releases/tag/v0.1.6)
provides the Apple Silicon desktop ZIP. It is 179376542 bytes, with SHA-256
`1a45ceaafcaaa8c5a62fadcb16bd42c495507c591c99ed223934240a6e81f699`.
Both the GitHub asset SHA-256 and updater SHA-512 pass. Strict deep signature
verification confirms `com.t3tools.t3code`, Team ID `ARK85ZXQ4Z`. Bundle and
ASAR version/build agree on `0.1.6`; its main entry remains
`apps/desktop/dist-electron/boot.cjs`.

## Isolated compatibility checks

The signed staging copies preserve all 16339 original Codex JavaScript files
and all 1826 original T3 JavaScript files byte-for-byte, together with each
archive's entire original data area. Codex native ASAR integrity stays enabled;
only 32 digest metadata bytes change. T3 retains its vendor-disabled integrity
setting, with no digest metadata changes. Both staged signatures pass strict
deep verification. Existing verification, signing and rollback logic is retained.

Codex content and per-message direction tests pass with the new vendor CSS.
An isolated native launch passes interface mounting, widget controls, saved
settings, custom Persian glyph rendering, question choices and queued messages.
The new T3 stylesheet passes mixed-language replies, RTL composition, code and
host isolation, panel controls, square accent boxes and persistence checks.

The Electron panel fixture now waits for the automatic update check triggered
by a channel change before simulating logout. Previously it could click the
disabled check button while that request was pending and incorrectly report
that signing out left Beta controls visible. This changes test synchronization,
without changing authentication or panel behavior.

## Previous-runtime panel test

Use the private workflow in [development-workflow.md](development-workflow.md).
The candidate version, exact source commit, signed feeds, downloaded ZIPs and
verification results are retained under `dist/develop-<candidate-version>`.
Public promotion and production-feed acceptance remain separate steps.

1. Update each host with its official updater yourself: Codex to
   `26.1027.51404` / build `23880`, and T3 Code to `0.1.6`.
2. If the vendor update removes Rasta, install the corresponding local-only
   previous-runtime Setup, then select Launch yourself:
   - Codex: `dist/compatibility/codex-20261101/previous-rasta/Rasta Setup.app`
   - T3: `dist/compatibility/t3-0.1.6/previous-rasta/Rasta T3 Setup.app`
3. Confirm Rasta `1.1.12` is installed. These separately signed compatibility
   Setups retain the preceding runtime version and only adapt host compatibility
   and initial feed handling. Initial installation has no release feed and
   ignores a saved Beta preference until that baseline runtime is installed.
   Automated probes verify it cannot upgrade to the candidate during initial
   Setup, including when Beta was selected previously. Record this baseline
   installation separately from release acceptance.
4. Keep Rasta `1.1.12` installed until starting the panel update. Enable the
   authenticated owner's Beta channel in each app. Close the panel and confirm
   the update dot on its button. Open it and select Check for updates (Refresh);
   confirm the exact candidate version in the local test guide.
5. Select Download update, complete the panel upgrade and select Launch
   yourself. Confirm the candidate version below Rasta in the header and normal
   app behavior, mixed-language content, per-message directions and saved fonts.

Record closed-panel dot, offered version, panel upgrade completion, displayed
version and normal app behavior separately for Codex and T3. All new manual
acceptance observations are pending; automated checks do not establish them.
Keep each app's state, backups, jobs, packages and feeds independent. Publish
publicly only after explicit acceptance of the exact source and ZIP bytes and
GitHub authorization; repeat the panel checks through Stable after publication.
