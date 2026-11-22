# Codex 26.1027.61615 compatibility

## Host and official download

The installed Codex at `/Applications/ChatGPT.app` identifies version
`26.1027.51404`, build `23880`, in its bundle and ASAR, with Rasta `1.1.14`.
The official [Codex appcast](https://persistent.oaistatic.com/codex-app-prod/appcast.xml)
offers `26.1027.61615`, build `24141`, for Apple Silicon. Its complete ZIP is
764978106 bytes, with SHA-256
`a22e81ff9e52e7f3006c657ff2006c034982876a5a8a002bbf9c00fbf8307f23`.
The archive's Ed25519 signature passes against the existing vendor key.
Strict deep bundle verification confirms the OpenAI identity and Team ID
`2DC432GLL2`. The downloaded bundle and ASAR agree on version and build;
the main entry remains `.vite/build/early-bootstrap.js`.

The new host was downloaded and tested separately. The agent did not close,
replace or install the original app. T3's host compatibility stays at `0.1.6`;
its state, backups, jobs, packages and feeds remain independent.

## Automated compatibility checks

The signed staged copy preserves all 16339 original JavaScript files
byte-for-byte and the archive's entire original data area. Native ASAR
integrity remains enabled; only 32 native digest metadata bytes change.
The staged copy passes strict deep signature and digest verification.
Download verification, signing and rollback behavior are unchanged.

Content and per-message direction checks pass against the new vendor CSS.
An isolated native launch passes interface mounting, panel controls, saved
settings, custom Persian glyph rendering, question choices and queued-message
styling. These automated checks do not establish manual acceptance.

## Previous-runtime panel update

Use the signed local test process in [development-workflow.md](development-workflow.md).
The workflow builds both app packages, verifies their downloaded ZIPs and
updates their separate signed private feeds. Public distribution requires
explicit acceptance of the exact candidate and GitHub authorization.

1. Update Codex through its official updater to `26.1027.61615` / build `24141`.
   Select its restart yourself.
2. If that update removes Rasta, open the local-only compatibility Setup at
   `dist/compatibility/codex-20261102/previous-rasta/Rasta Setup.app`.
   Complete installation and select Launch yourself. Confirm Rasta `1.1.14`.
   This signed Setup retains the previous runtime and has no initial feed.
   An automated probe verifies that a saved Beta preference cannot upgrade
   it during initial installation. Record this baseline installation separately.
3. Keep Rasta `1.1.14` installed until starting the panel update. Enable the
   authenticated owner's Beta channel. Close the panel and confirm the update
   dot on its closed button.
4. Open the panel and select Check for updates (Refresh). Confirm the exact
   candidate version recorded in the downloaded candidate's local test guide.
5. Select Download update, complete the panel upgrade and select Launch yourself.
   Confirm the candidate version below Rasta in the header and normal Codex
   behavior, mixed-language reading, per-message directions and saved fonts.

Record the closed-panel dot, offered version, panel upgrade completion,
displayed version and normal behavior separately for Codex and T3. T3 can
test the paired candidate through its existing panel on `0.1.6`; it needs no
new compatibility Setup for this Codex update. All new manual observations
are pending. Repeat production-feed checks separately after authorized
public promotion.

Local evidence is retained under `dist/compatibility/codex-20261102`, including
the appcast, verified download metadata, staging report, native validation,
test logs and previous-runtime Setup. The candidate's source commit, ZIP
hashes and independent feed/download verification belong in `dist/develop-<version>`.
