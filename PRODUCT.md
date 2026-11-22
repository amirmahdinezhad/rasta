# Product

<!-- impeccable:product-schema 1 -->

## Platform

macOS desktop

## Product Purpose

Rasta adds right-to-left reading to eight macOS AI agent apps, including Codex, T3 Code, Antigravity, Claude, OpenCode, ZCode, Grok Bot, and Gemini. Library manages each connection independently in a native AppKit window using WKWebView. The Apple Silicon 1.0.0 release candidate and signed local test builds cover all eight connections. The native Gemini adapter requires Apple Silicon and applies reading preferences to sent prompts, replies and drafts.

## Operating Context

Users discover installed apps, download a selected connection, review preparation progress and explicitly select Launch to install it. Existing host applications, verification, backups and rollback must remain intact.

Deliver the current release as an Apple Silicon installer with a matching signed updater package. Owner approval controls version changes and publication. Release candidates pass the local test and security gates and native Library acceptance before public publication. The [release workflow](docs/development-workflow.md) defines the evidence and checks.

## Capabilities and Constraints

The manager owns fonts, reading settings, updates and removal. Users can remove any reading font, including bundled Vazir, while the connection has another usable font. Removing the active font selects Vazir when available, or the first remaining imported font. Host quick actions open the appropriate connection.

Every new Library connection starts with Rasta enabled, Vazir at 16 px, Comfortable spacing, Enable RTL on and Force RTL off. Updates and repairs retain the preferences saved for each connection.

Enable RTL (Right-to-left reading in Library) controls both Force RTL and Type @ with Shift+2 for every supported host. Turning off Enable RTL disables both switches and stops both behaviors. Library and the shared host panel keep the saved choices visible on the disabled switches. Turning RTL back on restores those choices.

While Enable RTL is on, Force RTL takes precedence over per-response direction choices and hides their controls. Turning Force RTL off restores the previous choices and controls.

In Gemini, hovering a response reveals its direction button beside the first line, on an edge that clears the rendered text. The button stays in place as the pointer moves within the response and stays hidden when both edges are occupied.

The shared host panel's Close button shows a distinct hover fill in light and dark appearances, including while it has keyboard focus.

Re-selecting the effective reading font, size or spacing closes the menu without saving an override or showing a save notification.
Re-selecting the active appearance leaves the saved preference untouched.

Assistant responses have an independent left-to-right or right-to-left control across the eight Library hosts. The choice survives reopening in hosts that expose stable response IDs. Antigravity and the native Gemini adapter keep the choice while the response is rendered.
The direction control starts hidden, including after a direction has been saved. Hovering over a response reveals that response's control. In Electron hosts, keyboard focus also reveals the button.
In ZCode, the direction control appears at the bottom right of each assistant response, below its content and any host actions.

The Library and shared host panel display the full face name for each imported reading font. Each imported TTF or OTF file is a separate choice, and that file supplies the face used for reading on its connection. Adding or removing a font keeps the reading panel open and returns focus to the Font control.
The desktop font chooser limits selection to TTF and OTF files. The shared host panel presents reading preference and font errors in toasts, including the reason each font failed to import.

The in-app Rasta shortcut appears only on a visible chat surface, including an empty chat with its composer. Leaving chat hides the shortcut and dismisses its open panel.

Provider cards show the app logo, connection status and settings. The switch starts installation for supported connections that are not installed. Installed connections show a trash button that opens removal confirmation.

A first installation waiting for Launch can also be removed from its card or through Settings. Removing a connection clears its Rasta settings and saved package and returns it to the first installation step in Library.

Each Library card shows when its Rasta removal is queued or in progress and opens the connection’s removal status. The card offers installation again after successful removal.

Library shows the current preparation step for every connection. Preparation continues if the dialog closes, and reopening the connection shows its progress or Launch action. The dialog omits a separate reminder about closing it.

After Launch approval, Library follows the same operation through installation and confirmed startup. A failed Launch request can be retried when the same preparation is still waiting for approval.

In the signed local test manager, Library offers preparation for an installed connection while that host lacks the bundled build. Each connection identifies the build independently of its displayed version. A fresh installation ignores failures belonging to an earlier test build.

## Brand Commitments

Keep the Rasta identity, actual provider logos, English interface copy and the established neutral surfaces with a blue accent. The user rejected purple and multiple color themes.

Use a black tile and three white strokes for app icons and documentation artwork. The Library header and in-app reading controls use appearance-adaptive marks.

## Accessibility & Inclusion

Keep keyboard access, visible focus, explicit control names and reduced-motion support. Reading preferences and updates remain independent for each connection.

Typography menus in the shared host panel enter with the same short vertical motion and fade. Their width and horizontal position stay fixed during entry. Keyboard openings and reduced-motion mode show the menu immediately.
