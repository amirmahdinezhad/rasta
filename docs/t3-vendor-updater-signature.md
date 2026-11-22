# T3 official updater signature compatibility

## Failure and cause

The installed T3 bundle and ASAR identify version/build `0.1.5`, with Rasta
`1.1.12`. Its desktop trace records `Desktop updater install operation reported
an error.` with the cause `Code signature at URL [redacted URL] did not pass
validation: code failed to satisfy specified code requirement(s)`.

Rasta's local signing replaced the host's vendor designated requirement with
an implicit ad-hoc `cdhash` requirement. Squirrel reads the running host's
designated requirement and applies it to the downloaded official app. A new
vendor app cannot have the patched host's exact code hash, so verification
failed. Removing Rasta restored the pristine vendor requirement and allowed
the same official update to proceed.

The [Squirrel signature implementation](https://github.com/Squirrel/Squirrel.Mac/blob/main/Squirrel/SQRLCodeSignature.m)
reads this requirement with `SecCodeCopyDesignatedRequirement` and checks the
downloaded app with `SecStaticCodeCheckValidityWithErrors`, including strict,
nested-code and all-architecture validation.

## Fix and verification

T3 host signing now preserves the original signing requirements alongside
identifier, flags and runtime metadata. The original requirement retains the
T3 bundle identifier, Apple certificate chain and vendor Team ID `ARK85ZXQ4Z`.
The patched host remains locally signed. No certificate is impersonated and
no download or signature verification is disabled. Codex signing behavior and
native integrity checks are unchanged. T3's vendor integrity setting, original
application logic, backups and rollback remain intact.

The regression test stages a T3 fixture through the production signing path,
then checks a new version against the staged host requirement. It fails with
the original code-hash requirement and passes after the fix; a re-signed app
with an unrelated identity is still rejected.

An isolated probe invokes `SQRLCodeSignature` from the actual T3 `0.1.5`
Squirrel framework, without launching or modifying the installed app. Its
native validation rejects the official `0.1.6` bundle against the installed
pre-fix host, accepts it against the fixed staging copy, and rejects a different
vendor's app. The probe and results are retained in
`dist/t3-updater-signature/`. Automated checks do not establish manual acceptance.

## Current-host repair and manual test

The agent leaves the installed app running and unchanged. A signed local-only
repair Setup at `dist/t3-updater-signature/repair-current-host/Rasta T3 Setup.app`
retains Rasta `1.1.12`, supports T3 `0.1.5`, and includes the signing fix. Its
initial operation suppresses release feeds even if Beta was selected earlier.
Existing per-app settings and backups stay in their own support directory.

1. While T3 is still `0.1.5`, open the repair Setup and complete the operation.
   Select Launch yourself. This is repair acceptance, separate from release
   acceptance.
2. Use T3's own official updater to install `0.1.6` and restart it yourself.
   Confirm the signature error no longer appears and normal T3 behavior
   returns. The vendor update normally replaces the patched app and removes
   the injected Rasta panel; this is expected.
3. If Rasta was removed, install the previous-runtime compatibility Setup at
   `dist/compatibility/t3-0.1.6/previous-rasta/Rasta T3 Setup.app`. Select Launch
   yourself and confirm the previous Rasta `1.1.12` runtime before proceeding.
   Initial Setup must not upgrade to the new candidate.
4. Follow `dist/develop-<candidate-version>/manual-test.md` to update that
   previous runtime through the separate signed local test feed. Record the
   closed-panel dot, Refresh offering the exact candidate, panel upgrade
   completion, displayed version and normal app behavior for T3 separately.
5. Record the same five candidate observations for Codex independently. Its
   candidate targets `26.1027.51404`; no T3 repair Setup belongs in its workflow.

Public promotion requires explicit acceptance of the exact candidate source
and ZIP bytes and GitHub publication authorization. Production-feed checks
must be recorded separately after promotion, as described in
[development-workflow.md](development-workflow.md).
