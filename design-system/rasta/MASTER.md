# Rasta manager design system

## Context

Operate surface: a macOS utility rendered in WKWebView, with a localhost-only UI preview for iteration. Keep the product identity, actual app logos, provider cards, header settings and blue action color. Preview feedback is not native installation acceptance. Package only on explicit user request.

## Direction

The user selected the Library direction from three localhost prototypes. The eight supported macOS apps share the same two-column Library card pattern. Opening a card reveals its reading and installation controls in a shadcn Dialog while the grid stays in place. A single column preserves the reading and keyboard order below 740px.

Use platform system typography for offline operation and familiar macOS controls. Heading 32px/650, provider title 15px/600, body 13–15px, secondary status 11–12px. Keep explanatory copy short and specific.

## Colors

Fixed Rasta marks use a black tile (`#000000`) and white right-aligned strokes
(`#FFFFFF`). The main Library header uses the existing appearance tokens.
Host controls retain their interaction states around the fixed mark.

| Token | Light | Dark |
| --- | --- | --- |
| Canvas | #F6F7F9 | #181B20 |
| Raised surface | #FFFFFF | #22262E |
| Text | #242B36 | #EFF2F8 |
| Muted text | #647083 | #A7B2C2 |
| Action | #3268B2 | #95BFF8 |
| Action text | #FFFFFF | #142B49 |
| Connected status | #26704F | #96D3B3 |
| Destructive action | #B54343 | #F3A3A3 |

Blue identifies actions; green identifies a connected state; red identifies destructive actions or an issue. Every status also has text. These are semantic colors, not selectable themes.

## Components and behavior

- Manager dialogs and confirmation dialogs dim the underlying view with a 35% black overlay and apply a 3px backdrop blur.
- Provider cards show the current installation status. The install switch appears on supported connections before installation. Installed connections show the trash button with removal confirmation. When installation removes the switch, closing the dialog returns focus to the card.
- Card disclosure labels name the next task: Reading preferences, Set up connection or What’s next. Preserve focus across passive status refreshes.
- Reading controls and their bilingual live preview come first. Connection versions and maintenance actions live under Connection details.
- Header actions include labels on desktop; compact icon buttons retain accessible names. Settings has an explicit Back to apps action.
- Download, verification, preparation, explicit Launch and completion stay inside the expanded connection area. Progress values represent actual signed-byte transport outside preview mode.
- One stroke language for interface SVG icons. Keep provider marks in their supplied proportions.
- Use 18px card corners and 12px preview corners, quiet elevation and consistent spacing. No decorative animation, external fonts or remote assets.
- Keep keyboard focus visible, switch hit regions at least 44px tall, contrast readable in both themes and content reflowing at narrow widths. Reduced Motion removes positional feedback and spinning; keyboard choices are immediate.

## Verified scope

Check the browser UI matrix, imported-font rendering, target isolation, actual-poll focus persistence and localhost simulation flows. Manual native acceptance remains separate.

## Library selection

Use a neutral canvas, two desktop card columns and a one-column narrow layout. The selected card keeps an accent outline. The connection popup has a close action returning focus to its card. Typography controls sit beside a real bilingual reading specimen on desktop and above it on narrow screens. Reading behavior controls share one visible group; maintenance stays under Connection details. Development-only preview tools live under a collapsed disclosure in Settings.

## Component stack

The canonical local manager is React in `ui/manager`, with shadcn/ui components backed by Radix and Tailwind CSS. Use Dialog for per-app settings, AlertDialog for removal, Select for custom option menus, Switch for state, Tabs for Reading/Connection, ScrollArea for popup scrolling and Progress for connection stages. Author styles with Tailwind utilities; CSS contains only shadcn theme tokens, base utilities and the bundled font declaration. Dynamic reading-font metrics and upstream Progress transforms use inline values because they represent runtime content.

The Connection tab uses an ordered four-step progress view. Download bytes describe transport; the overall bar stays below 100 percent until completion. Launch remains explicit. The Reading tab is available after installation. All three reading behavior switches are visible directly in Reading. Maintenance uses Accordion. Font import uses a shadcn Dialog with batch drop, paste and the system multi-file picker. Reading preferences fit at the normal window size and scroll on shorter windows. Brief operation feedback uses the shared Sonner toaster.

## Library interaction refinements

- A card has one full-surface shadcn navigation button. Provider identity is static; switch and removal controls are separate siblings above the navigation hit region. Pointer hover changes the card border/elevation and its action footer together. Keyboard focus provides equivalent affordance.
- Keep cards compact: identity, status, controls and action footer. Provider descriptions and the Made for your Mac / Local & private labels are omitted.
- Settings is a labeled outline action with a 20px gear icon. The manager version appears beside the Rasta brand on the main page.
- Item settings omit the promotional subtitle and version/simulation footer. The overview count labels simulated data as demo apps. DialogDescription supplies concise screen-reader context.
- Modal tabs use a flat line treatment with a primary-color active underline, aligned icons and stable spacing. Arrow-key navigation remains owned by shadcn/Radix.

Typography uses compact icon-and-label rows beside the live reading sample, with a dedicated Add font action. Appearance lives in Settings with persistent System, Light, and Dark options.

Inside the shared host panel, reading and typography errors use the existing toast. Font import failures include the file name and reason in the toast and keep the settings rows in place.
