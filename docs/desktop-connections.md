# Claude, OpenCode, ZCode and Grok Bot connections

Claude, OpenCode, ZCode and Grok Bot are four of the eight Library connections. Each has an independent package and feed in the private release workflow. Record native acceptance for the exact candidate of each host.

## Inspected identities

Observed on November 9, 2026. Versions and builds were read from the actual bundles and compared with their ASAR package metadata.

| Connection | Source inspected | Bundle identifier | Version / build | Package entry |
| --- | --- | --- | --- | --- |
| Claude | Installed `/Applications/Claude.app` | `com.anthropic.claudefordesktop` | `4.4212.0` / `4.4212.0` | `@ant/desktop`, `.vite/build/index.pre.js`, CommonJS |
| OpenCode | Official [v1.19.5 release](https://github.com/anomalyco/opencode/releases/tag/v1.19.5), extracted without installation | `ai.opencode.desktop` | `1.19.5` / `1.19.5` | `@opencode-ai/desktop`, `./out/main/index.js`, ESM |
| ZCode | Official [Z.ai installer](https://zcode.z.ai/en/docs/install), mounted read-only | `dev.zcode.app` | `3.17.2` / `3.17.2.9661` | `@zcode/desktop`, `out/main/index.js`, ESM |

On November 20, the installed ZCode bundle reported version `3.18.2` and build `3.18.2.10443`. Its ASAR reported the same version and retained the existing ESM entry, file renderer and CommonJS preload.

On November 10, the installed OpenCode bundle reported version and build `2.2.7` and kept the same bundle identity. Its ASAR uses `@opencode/desktop` with the same ESM entry and a CommonJS preload. Both variants still authorize only the top-level `oc://renderer/index.html` surface. ZCode means the product at [zcode.z.ai](https://zcode.z.ai/en), as confirmed by the user. Upstream source was consulted at [anomalyco/opencode](https://github.com/anomalyco/opencode) and [zai-org/ZCode](https://github.com/zai-org/ZCode). Bundle contents determine the integration contract.

## Integration

These desktop adapters reuse Rasta's atomic preparation, explicit Launch, local signing, signature checks, saved original, update handoff and rollback. Original vendor JavaScript and HTML descriptors and data bytes remain intact. Only package startup metadata and appended Rasta files change.

CommonJS Claude starts through `rasta/main.cjs`. OpenCode and ZCode retain `type: module` and start through `rasta/main.mjs`. Its ordered static imports register Rasta before evaluating the original ESM entry. Vendor dependencies and their resolution are unchanged. A real-ASAR Electron test exercises that startup order.

Claude `6.28899.2` uses `.vite/build/launcher.js` as its CommonJS entry. Rasta checks that this launcher delegates to `index.pre.js` and runs the original launcher, preserving its startup initialization. A whole-bundle update by Claude replaces the in-app patch. Library recognizes the previously installed connection and can prepare recovery against the new vendor bundle for the user's Launch.

Registered preloads expose fixed status, update and preference operations, the three reading switches, and opening the appropriate Rasta manager card. The compact in-app panel is available without an update offer. The API and presentation execute in isolated world `1005`. Font management and installation remain in Library. Browser guests, frames, login pages, arbitrary local files and auxiliary surfaces are rejected.

| Host | Authorized surface | Reading selectors from inspected UI |
| --- | --- | --- |
| Claude | The vendor registry's current `mainView.webContents` at `app://localhost` or `https://claude.ai`; its separate window chrome is excluded | User/assistant message test IDs, turn keys, composer |
| OpenCode | An owned BrowserWindow main frame at `oc://renderer/index.html` | Markdown, user-message and prompt-input components |
| ZCode | An owned BrowserWindow main frame at the exact bundled `out/renderer/index.html` file | Turn IDs/keys and composer |
| Grok Bot | An owned BrowserWindow main frame at the exact bundled `dist/renderer/index.html` file | `sand-message-prose` and editable descendants of `sand-chat-input-dock` |

Claude's hashed registry module and exported getter are discovered from the inspected source shape; ambiguous or missing matches fail compatibility checks. Runtime authorization reads only the already-loaded module cache, preserving vendor initialization order. OpenCode's renderer protocol and ZCode's file loader/preload contract are checked before preparation. The adapters do not register a replacement protocol, change networking, rewrite vendor preloads or inspect credentials.

Automatic and forced RTL, custom fonts, text size and line height reuse the existing reading engine. Code and terminal stacks remain excluded. Assistant responses use the shared left-to-right and right-to-left control. Claude saves the choice by chat and turn key. OpenCode uses the message and text-part IDs, ZCode uses the turn and assistant row IDs, and Grok Bot uses the assistant response ID. When the renderer supplies no usable ID, the choice lasts for the current rendered response. Login, custom provider configurations and normal native app behavior still require manual acceptance.

## Integrity and the ZCode packaging discrepancy

Claude's enabled native integrity digest remains enabled, including its dictionary entry for `ion-dist.asar`. The inspected OpenCode and ZCode frameworks ship with native digest enforcement disabled; Rasta preserves that vendor setting. It does not disable an enabled setting. Every staged bundle still receives updated ASAR metadata and signature verification, and restore retains the original vendor-signed bundle.

Both inspected ZCode builds have a valid Developer ID signature and stale `ElectronAsarIntegrity` metadata in their Info.plist. The SHA-256 measurements are recorded below.

| Measurement | `3.17.2.9661` | `3.18.2.10443` |
| --- | --- | --- |
| Actual ASAR header | `18c2c824634dc8181b650451aef684491f6a4aca89079ab25b445ddba32c1db1` | `75331ad272a0dd2d4dacb5df918fb41caa9f65dec2a1acd4b982b94c6e870136` |
| Header recorded in Info.plist | `c4f9b3d7eb0d10c962652e8d08a078415be498d17be02a827033ecf5faf1d3c6` | `c94d2619c7f0cbd2bff2ae21312f334760df46eae96310822e455958bdd7178f` |
| Entire ASAR, sealed by CodeResources | `12a2fc939df2fcb4188699772590f5151f1f2b90556bd34ecb6d44cf0d793cc6` | `236db1e6aeceb5fbbde3e28e69a3fcac4772c11787120efb41548e8d87c5ecb6` |

`vendor-baseline.js` can reconcile stale metadata for a compatible ZCode build with zero enabled native digest slots. It requires a SHA-256 resource seal for the bundle's `app.asar` and strict verification of the publisher's Developer ID chain and Team ID `8A5X4JJ39T`. The signature authenticates the resource seal and the full archive, including on builds Rasta has never seen. Rasta writes the corrected plist hash into the prepared copy and restores the signed vendor bundle on removal.

After ZCode replaces a working Rasta connection, open Rasta and select the ZCode card in Library to recover reading support. Library confirms the new bundle's identity, signature and adapter compatibility before starting recovery. It prepares with a compatible verified package from the selected channel, using the signed feed when the cache cannot be used. Reading preferences stay in ZCode's own support directory. Launch remains the user's approval, and a second vendor update invalidates the pending preparation.

Grok Bot 0.79.3 reports bundle ID `com.anysphere.sand` and ASAR package `sand`. The adapter follows its CommonJS startup from the existing ESM package and preserves the vendor-disabled native digest setting. Local resource preparation and an isolated Electron fixture passed. Native acceptance still requires Launch from Library.

## State and delivery

| Target | Application Support | Setup | Signed feed filename |
| --- | --- | --- | --- |
| `claude` | `Rasta Claude` | `Rasta Claude Setup.app` | `rasta-claude-release.json` |
| `opencode` | `Rasta OpenCode` | `Rasta OpenCode Setup.app` | `rasta-opencode-release.json` |
| `zcode` | `Rasta ZCode` | `Rasta ZCode Setup.app` | `rasta-zcode-release.json` |
| `grokbot` | `Rasta Grok Bot` | `Rasta Grok Bot Setup.app` | `rasta-grokbot-release.json` |

Each target owns its preferences, private font catalog, cache, jobs, backup, recovery and release verification. Follow the [release workflow](development-workflow.md) for the full local test catalog, platform coverage and native acceptance.

The manager offers connection flows for these targets. Localhost preview data simulates their presence, downloads, preparation, Launch, preferences and removal. Native discovery checks the installed bundles independently.

## Verification

- `npm run test:desktop`: discovery and identity rejection, version checks, archive preservation, signed fixture staging, ESM and CommonJS entrypoints, refresh rollback, exact restore, target isolation, signed feed separation, registry authorization, and a real Electron ASAR fixture for each host.
- Electron fixtures check automatic/forced RTL, an imported font, live text size, preserved code and chrome direction, vendor preload survival, private API isolation, rejected guests/frames, target-specific readiness, update shortcut and reload.
- `npm run test:manager-ui`: Library cards, explicit Launch, target-specific reading settings and removal, light/dark rendering, keyboard access and narrow layout.
- `npm run inspect:desktop`: read-only discovery of installed bundles. Optional `claude=/absolute/Claude.app`, `opencode=/absolute/OpenCode.app` and `zcode=/absolute/ZCode.app` arguments inspect extracted bundles.
- `npm run test:language`, `npm test` and Swift type checking cover shared and native changes.

Resource-only preparation was also run against all three inspected vendor bundles. The generated archives preserved their original data area, original archives retained their complete hashes, and temporary prepared resources were removed afterward. Claude required 32 bytes of native digest updates; the two vendor-disabled frameworks required none. These checks did not execute a vendor app.

## Manual acceptance pending packaged output

When the user requests installers, read `development-workflow.md` before changing CI. Prepare signed local test packages and verify downloads independently. The user selects Launch. Record actual conversation/composer RTL and fonts, authentication, ordinary app behavior, same-version restore and vendor-update recovery for each app separately.

Record clean installation separately from update acceptance. Supply the previous connection and the exact candidate when testing an upgrade. Use a local compatibility package if the previous version cannot install on the current host. Keep the previous connection installed until the owner starts the update. For each app, record its update indicator or Refresh offer where applicable, the completed upgrade, displayed version and normal behavior. Verify that the host shortcut opens the correct card and that updates affect the selected connection. Production-feed acceptance follows explicit publication authorization.
