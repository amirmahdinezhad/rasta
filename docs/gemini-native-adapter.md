# Gemini native candidate validation

Gemini has an independent native adapter for Apple Silicon, available through signed local builds and the signed local test workflow. Record live acceptance for each native candidate. The probes below document the isolated adapter checks.

## Observed host

The vendor baseline inspected for the original probe was `/Applications/Gemini.app`, identifier `com.google.GeminiMacOS`, version and build `1.141.3.1394`. It has a native arm64 executable and no Electron ASAR. Its code signature uses hardened runtime and Google Team ID `EQHXZ8M8AV`. The locally installed test connection inspected on 21 November 2026 was version and build `1.147.5.1526`. Its executable contains the native message, attachment and table text views used by the updated adapter.

A user-authorized, metadata-only Accessibility inspection found native SwiftUI controls and an RTL response exposed as non-settable static text. The composer exposes its value and selection, but no writable font or direction. No `AXWebArea` was exposed. Accessibility cannot provide the existing renderer injection path. The temporary inspector's Accessibility permissions were disabled after inspection.

The executable imports Core Text line and framesetter factories. The native message views also use the AppKit text system. Confirm the paths used by real conversations during native acceptance.

## Reproducible isolated checks

Run `node tools/probe-gemini-text.mjs` on arm64 macOS with the Command Line Tools installed. It builds and removes a disposable executable and dylib. The fixture verifies Persian font and direction changes, both Core Text factories, unchanged English and monospaced code, unchanged source attributes, and the disabled state. It records whether this macOS release permits loading two ad-hoc signed images, then verifies the final executable's signature, explicit local-signing entitlements and working text factories. It never launches Gemini.

Run `node tools/probe-gemini-bundle.mjs` to inspect the installed vendor signature and prepare a disposable copy. The probe adds a short loader command in verified zero-filled header padding, compiles the diagnostic library, signs the copy locally, and verifies its complete signature. It compares every original file except the executable's modified header/signature and the app's replaced signature resource. The installed executable is checked again before cleanup. No app is launched, installed, registered, closed or replaced.

On the observed host, the executable has 72 bytes of padding. The loader fits without moving sections. All original executable section bytes and 4,283 other original files were preserved, and strict deep signature verification passed on the disposable copy. Team-bound entitlements cannot survive ad-hoc signing; the fixture uses `localSigningEntitlements`, not the vendor's original signing identity. These checks establish staging feasibility only.

`node --test test/macho-loader.test.js` covers byte preservation, duplicate loader rejection, insufficient or occupied padding, incompatible architectures and malformed section/signature ranges.

## Implemented candidate path

The native library configures Core Text before the vendor creates its initial text layouts. It preserves attributed strings, monospaced runs and paragraph properties, and changes only paragraphs containing RTL text unless forced direction is selected. Calls from frameworks are excluded. A borderless 28-point Rasta button, inset 16 points from the physical bottom and right content edges, opens the current shared shadcn panel in a transparent WebKit view. Both controls sit in an overlay above the SwiftUI content inside the existing window. The overlay passes input to Gemini wherever Rasta has no control. The native button draws the shared mark and matches the desktop trigger's light, dark, hover and expanded fills. The bridge permits only the signed local main frame and fixed service actions. Shift+2 inserts an at sign in an editable multiline text view, excluding field editors and marked-text composition.

The launcher requires a visible Gemini Rich Input composer in an eligible window. Gemini Settings and windows covered by a native sheet are excluded. When a window leaves chat, the adapter removes its launcher and dismisses its panel.

Library uses the same explicit Launch gate as other connections. Preparation checks the Google signature, preserves all original executable sections and signs a separate staged bundle. Commit records an independent backup and verifies the completed installation, with rollback on failure. Removal restores the exact original bundle and refuses to downgrade a vendor update. Readiness requires configured text support, an initialized host window and a mounted shared panel.

The adapter applies font, size and line gap to the canvas, message tree, unified transcript and Rich Input composer. It identifies the plain text view used for sent prompts by its SwiftUI host and uses the vendor's `JanusUserPromptBubble` attribute to identify sent lines within the unified transcript. These lines can be stored as separate paragraphs. The adapter applies the gap between lines of the same bubble and mirrors the transcript's insets for RTL to keep the text in its original column. RTL paragraphs use explicit right alignment, including wrapped lines. English keeps its existing direction unless forced direction is enabled.

Gemini 1.147.5.1526 and 1.147.6.1557 have another sent-bubble path that creates SwiftUI `Text` values. On macOS 26 and later, the adapter applies SwiftUI font, alignment and line-height attributes at the verified plain and attributed text call sites for each build. It checks the main executable, build and instructions before changing either result. SwiftUI observation invalidates the prompt when preferences change so already-visible prompts can rebuild through the same path. AppKit handles the composer and its editing state. [SwiftUI text attributes](https://developer.apple.com/videos/play/wwdc2025/280/)

New message views receive their saved styling when they join the window. Streaming and draft edits receive the current styling through the text storage delegate before layout, with the vendor's delegate callbacks preserved. If Gemini replaces that delegate and edits the text, the next reading refresh uses the current content before applying the saved typography. The composer uses attribute-only changes and defers styling while it has marked text. Both settings surfaces write to the Gemini preference store. When the host sees a save, it recalculates visible styles from the vendor's source attributes.

Hovering over an AppKit assistant response reveals the direction button. In the unified transcript, tagged sent prompts delimit the surrounding responses. The button applies alignment and writing direction within the selected response range and retains the choice while that range remains in the rendered transcript. Monospaced code, prompt formatting and composer state continue to use their own styles.

`npm run test:gemini` verifies the text factories and runs a disposable native host. It checks launcher placement, pointer targeting, focus return and dropdown shadows in WebKit. The native fixtures exercise the real panel service and Library preference action. They verify the first response layout, incoming streaming edits, and the measured distance between lines at the same font size. The SwiftUI rendering fixture exercises both Text initializers and checks right alignment, measured line height and restoring an already displayed prompt on a preference change. The suite also checks vendor callbacks, selection, links, monospaced code, unrelated native views, readiness, rollback, refresh and exact restoration. `node tools/verify-gemini-candidate.mjs <absolute-runtime-path>` exercises the packaged preparation entry point against a disposable copy of the installed Google bundle without committing or launching it.

## Required manual acceptance

- Confirm the live response's rendering path. A main-executable caller check alone does not distinguish messages from other native UI text; verify reading changes do not disturb other native UI.
- Preserve rich-text traits, paragraph formatting, code, selection and copying. Verify mixed paragraphs, links, tables and streaming responses, not only a single line.
- Change font and size from both settings surfaces with a sent prompt and a response visible. At a fixed size, switch from Compact to Spacious and check the gap between lines in both. Send a new prompt with a distinctive font selected and check the response from its first visible line through streaming. Verify direction, dropdown shadows and Shift+2 in the composer.
- Check the independent Library download, explicit Launch, completed installation, version displayed on the card, host operation and removal. A loaded dylib alone must never count as a successful reading integration.
- Prepare a separate private candidate and obtain the user's observations after Launch before claiming native acceptance. Keep the original installed host untouched during preparation.
