# Codex update recovery

Official Codex updates replace the in-bundle Rasta integration. Open the Codex connection in Rasta.app Library to prepare recovery. Library can reuse a compatible, verified package. Codex stays open during preparation and exits normally after the user selects Launch. Successful installation retires the owned legacy recovery copy and update watcher. T3 keeps independent runtime state, feeds and compatibility checks.

## Compatibility policy

Codex repair in Library targets the installed version, even if a newer official update exists. It checks the archive identity, CommonJS startup entry, both HTML entry points, the preload API name in the Electron binary, enabled native integrity metadata and the matching ASAR header digest. The API-name check is a conservative static prerequisite, not proof that a future Electron implementation behaves the same. A verified newer Rasta engine may be downloaded even if the current adapter fails; the new engine repeats local checks before staging or requesting quit. Signed staging still validates the source signature, preserves original JavaScript bytes, signs and verifies the prepared copy, and rejects changes to the host during preparation or commit.

Tested hosts and unverified hosts must both pass local checks. Library displays a compatibility notice for an unverified host. Unverified is not an assurance of runtime or DOM compatibility. Optional message-context and per-message direction failures are isolated from the settings panel and basic reading controls. Missing selectors can still leave a feature unavailable without throwing; automated checks cannot establish support for every future UI.

Vendor and Rasta feed errors do not block repair using the current local runtime. Offline recovery cannot discover new incompatibility reports. Optional `blockedAppVersions` entries in signed release metadata are cached with their signature and checked again offline. The UI cache cannot authorize an update or override this policy. A failed signature check does not replace authenticated cached policy. Online package downloads still require the signed manifest and exact size/hash verification. Private Beta authentication remains required for private downloads.

A failed preflight or staging operation leaves the host unchanged. The existing transaction restores the pre-operation bundle if commit fails. An old backup must never replace an independently updated Codex. Runtime startup failure after a successful commit is reported separately; automatic launch confirmation is not manual acceptance.

## Private candidate acceptance

Leave the previous connection installed until starting the update in Library. Check the closed-panel update dot and the shortcut to the Codex card separately. In Library, verify the intended version, prepare the connection, select Launch, and confirm the connection version and saved reading settings after Codex opens.

For vendor-update recovery, update Codex through its own updater. Open Library, review compatibility, choose Prepare recovery, and select Launch when it is ready. Confirm the panel and preferences return. Repeat offline with a compatible previously verified package to exercise local recovery. Keep manual acceptance pending when only signed fixtures were available. Repeat the Library checks on Stable after authorized publication.

See [installer architecture](installer-architecture.md) for shared staging and release verification.
