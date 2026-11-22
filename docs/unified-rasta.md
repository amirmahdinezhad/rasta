# Unified Rasta application

Rasta.app Library manages the eight macOS connections. Each Rasta DMG contains the manager, its portable runtime and compact packages for its release scope. The Apple Silicon 1.0.0 candidate includes all eight connections. The [release workflow](development-workflow.md) covers signed local test builds and release acceptance.

## Installation

Open the DMG to see the installation guide in Finder. Drag the Rasta icon onto the Applications folder beside it, then open Rasta from Applications. The icons are real Finder items; the arrow and instructions are a bundled static background. Opening Rasta inside the disk image does not copy it into Applications.

The DMG build saves the icon positions, window size and background in the image itself, then reopens the compressed read-only image to verify the layout files, Applications link and app signature. Layout preparation addresses its temporary mount by path, so another mounted Rasta image cannot receive its changes.

## Responsibilities

The manager discovers installed host identities, reads existing connection metadata without migrating or rewriting per-app settings, and checks the signed feed for the selected connection. Each connection retains its existing runtime, backups, fonts, jobs, release version and verified update worker. The manager uses a separate Application Support directory (`Rasta Manager`), feed (`rasta-manager-release.json`) and update artifact. Connection updates do not update the manager or another connection. `ARTL_MANAGER_VERSION` can version the core independently from connection packages; packaging defaults to the approved source version.

Installation and updates check the signed public feed. The installer also contains a signed manifest for its bundled packages. Rasta uses its bundled compact ZIP when the hash and size match the offer, or downloads the selected package when needed. Each verified ZIP is cached atomically under its target ID. A failed download retains the preceding usable cache. Before using a cached package, Rasta verifies its ZIP hash, extracted bundle signature, target and version. Installed runtimes are adopted for offline repair. A new host must still pass the connection engine's own compatibility checks and staging verification. Offline availability is not a promise of support for arbitrary future host internals.

Connection download, verification, preparation, Launch approval and completion are displayed in the selected manager section. Each connection runs through its own background worker. Library displays its progress. Download progress reports actual received and signed total bytes. Preparation never authorizes replacement: the user selects Launch in the same section before the worker requests normal host termination, verifies the staged bundle, installs and reopens it. Signing, integrity, same-version restore and rollback remain active. Open the affected app card in Library to recover reading support after a host update. The internal package tool handles archive verification and keeps the executable path used by existing signed packages.

Library and the shared host panel use the same reading preferences, including font, text size, line height, RTL enablement, forced text direction and the keyboard @ fix. Each target stores its own font catalog and preferences in its existing support directory. The renderer observes preference changes and applies the selected face without restarting the host. Code and terminal font stacks are preserved. Font files stay on this Mac.

Inside a supported chat surface, the Rasta shortcut opens the shared reading panel. The panel offers reading controls and Refresh, which opens the matching Library card when a connection update is available. Per-message direction actions are separate from the app's font controls.

Connection removal uses a destructive confirmation in the manager, then the same inline operation section. Full removal proceeds through each connection before removing the manager data and moving Rasta.app to Trash. Failed trashing leaves an actionable manual-removal message. Dragging Rasta.app to Trash alone does not remove patched connections.

Core updates use a separate signed feed. Their download, verification and Restart and update action remain in Rasta settings. An internal helper waits for the manager to exit, verifies the prepared bundle again, replaces only Rasta.app, reopens it and restores the previous manager on failure. No Finder or secondary installation window opens. Connection state is untouched. Updates are never silently installed. Core and connection release numbers are displayed only in the manager.

## Security

The local WKWebView exposes a fixed JSON action allowlist through a native bridge. Navigation is restricted to the bundled manager page, remote connections are disabled by CSP, and inputs never become shell code. Renderer-supplied filesystem paths and executable names are not accepted. One mutating native operation runs at a time. Per-target worker locks remain authoritative for host installation.

## Build and release

The [local release workflow](development-workflow.md) builds and verifies
the Apple Silicon DMG and updater ZIP. The owner installs each candidate directly. Publication uses the exact accepted ZIP and DMG with their corresponding signed feeds.

## Design contract

The [manager design system](../design-system/rasta/MASTER.md) defines the shared provider cards, platform typography and semantic states. Every supported app uses the same connection card pattern, including the native Gemini adapter. Connection dialogs show reading controls first and keep version details, repair and download under Installation. Header actions retain accessible names at narrow widths.

Motion follows Emil Kowalski's decision framework: expanding a provider reveals its details with a turning disclosure icon; incoming content uses 180 ms opacity and a 4 px translation with `cubic-bezier(.23,1,.32,1)`. Pointer presses use a 140 ms scale response. Keyboard selections are immediate. Rapid provider changes cancel and retarget the previous content animation. Refresh rotates at 800 ms linearly only during the real check. Byte progress uses `scaleX`, never animated width. Reduced Motion removes positional movement and spinning while preserving textual operation feedback. Passive status updates preserve focused reading controls.

## Verification and manual acceptance

Automated tests cover matching bundled packages, target-only fallback downloads, cache corruption, failed-download rollback, host discovery without host mutation, cancellation, light/dark rendering, narrow windows and reduced motion. Native self-test loads the bundled page and bridge without installing or removing a host connection.

For manual acceptance, detect the hosts in the candidate's scope, prepare each connection from its matching bundled package, and verify a selected download when the signed feed offers a different compatible package. Test offline repair, a target-only update, removal, full cleanup and normal app behavior. Keep the previous connection installed until starting its verified replacement. Record the completed upgrade, candidate version in Library and working host separately for each connection. When a host shortcut changes, confirm that it opens the correct Library card.
