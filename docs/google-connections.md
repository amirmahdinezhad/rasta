# Google desktop connections

Antigravity and Gemini are part of the Rasta Library catalog. Each uses an independent adapter, package and signed feed in the signed local test workflow. The native Gemini adapter requires Apple Silicon. Record acceptance for the exact build of each connection before public promotion.

## Observed hosts

Read from the installed bundles on November 9, 2026:

| Target | Bundle identifier | Bundle version / build | Archive / startup |
| --- | --- | --- | --- |
| Antigravity | `com.google.antigravity` | `2.29.1` / `2.29.1` | `antigravity@2.29.1`, `dist/main.js` |
| Gemini | `com.google.GeminiMacOS` | `1.138.0.1315` / `1.138.0.1315` | Native executable; no Electron ASAR |

Antigravity here means the installed agentic desktop Hub, not the separate Antigravity IDE. Other bundle identities and future startup architectures require their own compatibility assessment. Gemini here means Google's installed native macOS app, not Gemini CLI, a browser installation or MacPaw's similarly named app.

## Integration

1. **Discovery and ownership: implemented.** A shared target catalog provides stable names, package identities, support directories, Setup names and feed filenames. Discovery reads the actual Google bundle identity and version/build. Antigravity additionally checks the package identity and archive version. Gemini is discoverable without being passed to Electron installation code. Unknown target IDs fail instead of falling back to Codex.
2. **Antigravity adapter: implemented locally.** The existing atomic staging, signing, integrity verification, backup and same-version restore engine is reused. The archive retains its original data area and all vendor JavaScript descriptors. A new CommonJS wrapper starts the original main entry without rewriting it. No HTML injection is attempted: the vendor language server owns the Hub UI.
3. **Host presentation and controls: fixture verified.** A registered frame preload authenticates against the already-loaded vendor Hub registry (`getHubWindows` and `getHubWebContents`). The bridge never loads that module ahead of vendor startup. Only a main frame owned by a registered Hub at its HTTPS loopback URL may request fixed status and preference operations, save the three reading switches, or open Library for an update. Its compact Rasta button opens the in-app panel. The presentation and API live in isolated world `1004`, outside the page's main world. Browser guests and iframes receive no reading controls. Vendor preloads, certificate handling, language-server startup and navigation are not rewritten.
4. **Manager integration.** Antigravity and Gemini have separate Library cards and simulated preview workflows. Font and reading preferences, caches, workers, recovery paths and signed manifests remain scoped to each app.
5. **Native Gemini adapter.** The adapter integrates with the macOS text stack and uses the shared reading panel inside the host. See [Gemini candidate validation](gemini-native-adapter.md) for supported rendering paths and isolated verification.
6. **Delivery.** The private workflow prepares signed artifacts for both connections and verifies their downloads. Record the owner's real Library and Launch observations for each candidate.

## Integrity and update boundaries

The observed Antigravity framework has vendor-disabled native ASAR digest metadata. As with T3, the adapter explicitly permits and preserves that vendor setting; it does not disable an enabled setting. Codex continues to require enabled native integrity. The ASAR header hash, bundle signature and staged bytes remain checked. Antigravity retains its vendor updater configuration and designated requirement during local signing; real vendor-update behavior still needs manual verification.

Each host keeps its own original backup. Antigravity never uses a Codex vendor download or appcast. Its internal connection package uses the bundle name `Rasta Antigravity Setup.app`, its data lives under `Rasta Antigravity`, and its signed release must name target `antigravity`. Gemini cannot consume that release. Existing Codex and T3 versions and feeds remain separate.

Antigravity uses the shared direction control on Hub assistant responses. The Hub marker used by Rasta carries no verified persistent message ID, so each choice lasts for the current rendered response. Live Hub coverage remains part of native acceptance.

## Local verification

- `npm run inspect:google` reads local versions and compatibility without launching a host.
- `npm run test:antigravity` checks discovery, target isolation, signed fixture staging/restore, native bridge authorization and an actual isolated Electron Hub with a local HTTPS fixture.
- `npm test` covers the existing engines plus independent Antigravity signed feed validation and cache isolation.
- `npm run test:language` checks explanatory copy.
- `npm run test:manager-ui` uses `ARTL_PLAYWRIGHT_MODULE` pointing at an installed Playwright entry and exercises simulated Library workflows.
- `npm run test:gemini` covers Core Text and SwiftUI probes and the isolated native Gemini fixture, including staged install, reading controls and restoration.
- `npm run preview:manager` serves simulated connections on localhost. It never installs a host connection.

Icons are taken from the inspected local application bundles; see `bin/manager/icons/README.md`.

## Packaged manual acceptance, when requested

Follow `development-workflow.md` before changing CI or preparing a local test installer. Use the independently signed test feed for the connection being tested. Verify downloaded ZIP bytes and extracted signatures separately from local files.

For each app, record clean installation and normal host behavior separately from upgrade acceptance. Supply the previous connection and exact candidate, using a local compatibility test package if the previous connection cannot install on the current host. Keep the previous connection installed until the user starts the update. Record the owner-selected Launch, completed upgrade, displayed version and working host. Verify that the host button opens the reading panel and that the update action opens the correct Library card.
