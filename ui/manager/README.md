# Rasta manager interface

The selected Library design is implemented in React with official shadcn/ui components, Radix primitives and Tailwind CSS. Start it from the repository root with `npm run preview:manager`; the existing `/manager/index.html` URL redirects to the new localhost entry.

Install this interface's dependencies with `npm --prefix ui/manager ci`. They are isolated from the packaged service's Node dependencies. `npm run build:manager-ui` checks types and emits only browser assets into `dist/manager-ui`; it does not build a native app or installer.

## Design direction

The manager uses an achromatic primary, nested neutral surfaces and capsule navigation based on the supplied visual references. The Library supports All apps and Connected filters, including a real empty state and focus recovery after removal. Reading preferences and the four-stage connection flow share the same surface system. See `../../docs/manager-design.md` for the reference interpretation and complete Meng To skill review.

## Components and styling

`components.json` records the shadcn registry configuration. Components under `src/components/ui` were added with the official CLI. Local adaptations use the shared `cn` helper, reduced-motion and keyboard variants, and short pointer feedback. Future components should use the same registry and Tailwind conventions.

`src/index.css` owns theme tokens and the bundled font declaration. Layout, spacing, color, motion and responsive treatment use Tailwind classes. Runtime font family, font size and line height are user content and use inline values. The upstream shadcn Progress component uses an inline indicator transform.

Connection settings open in Dialog. Reading and Connection tabs keep everyday preferences separate from setup and maintenance. Removing a connection uses AlertDialog; Select menus, Switch controls, Accordion disclosure, ScrollArea and Progress are shadcn components. Font import accepts file drop, clipboard paste or a multiple-file input in a custom Dialog. Selects and confirmations use shadcn components.

## Behavior and validation

`src/model.ts` retains the existing manager RPC contract and independent targets. Preparation never starts Launch automatically. A popup can close while preparation runs; reopening it shows the current job. Fonts and reading settings stay scoped to their target.

Development imports the browser-only fixture from `tools/manager-preview/bridge.js`. Production builds omit that import and retain the native service bridge. Fixture controls remain available to automated tests through the browser fixture API; they are not part of the manager interface. Settings → Appearance offers System, Light, and Dark. It never contacts installed applications or release feeds.

Start the localhost preview, then run `ARTL_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:manager-ui`. The smoke check exercises the actual React surface and fixture: popup focus, custom menus, font import/decoding, target isolation, preparation/Launch, removal confirmation, retry, narrow layout and reduced motion. Run `npm run test:language` as well; TypeScript UI files are included by the language guard.

Native packaging compiles these assets in native mode into a classic single script for the signed WKWebView file surface. `tools/build-manager.mjs` replaces the legacy `bin/manager` surface in the copied runtime and applies its local content policy. Browser UI acceptance does not establish native acceptance. The native manager self-test checks actual card rendering and the service bridge.

## Shared host panel

`ConnectionPanel.tsx` reuses the same shadcn controls and tokens in a ShadowRoot. Its Dialog portal remains inside that root. `npm run build:panel-ui` compiles its production IIFE to `bin/panel/panel.js`. The shared Electron payload embeds it, and the Gemini adapter loads it through WebKit. Rebuild it after panel source changes. Manager and connection packaging rebuild it before copying the runtime.

The live simulated panel is at `/panel-preview` on the manager preview server. It offers theme, reading-status and update fixtures without contacting installed applications. Run `npm run test:connection-panel` with `ARTL_PLAYWRIGHT_MODULE` and the preview running. Run `npm run test:manager-production` with the same module path to build browser assets and test minified timing in Chromium and WebKit.
