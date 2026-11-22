# Manager design direction

The redesign adapts the five user-supplied image references into the existing manager Library and its dialogs. The references contribute surface hierarchy, compact controls, rounded nesting and neutral contrast. Their logos, content, phone hardware and menu-bar chrome are not copied.

## Visual language

- Reference 1: near-black surfaces, compact rounded modules and capsule navigation.
- Reference 2: an outer tray with inset content, quiet boundaries and a clear final action.
- Reference 3: light gray grouping surfaces, white content and soft neutral elevation.
- Reference 4: compact utility hierarchy and grouped progress information.
- Reference 5: monochrome provider rows, restrained borders and a quiet utility footer.

The primary is achromatic: charcoal (#303030) in light mode and pale gray (#e8e8e8) in dark mode. Success and destructive states retain semantic colors with text or icons. Shared tokens define background, shell, content, inset surfaces and three elevation levels. System typography stays compact: 26 px for Library, 18 px for dialog identity, 15 px for app identity, and 11–14 px for controls and secondary text. Rounded cards contain visibly inset action strips; their silhouettes remain separate from capsule navigation.

The refined controls keep destructive actions in the same rounded surface family: a quiet circular trash button, with a restrained warning state, and soft tinted confirmation actions. Library cards use equal visible top and bottom insets. Capsule bars use a 44 px track with an even 3 px inset and equal 24 px vertical space above and below navigation. Select triggers and portaled menus share one corner radius; menus open below the trigger with smaller 12 px option labels, and options use a smaller inset radius. Provider logos sit on a tonal tile. Switch thumbs keep an even 2 px inset at the top, bottom and resting end. Stage lines run from center to center behind their markers, and completed stages emphasize their outgoing line. Preview diagnostics and the overview simulation banner are omitted from the product surface; test fixtures remain internal and simulated Launch remains explicit.

The glass treatment uses translucent popup material, backdrop blur and soft elevation. Both themes use flat page and panel backgrounds. Segmented controls show selection with a translucent capsule, a soft directional sheen and a masked 1 px rim. The rim has its own gradient so it cannot tint the fill. Separate mask image, clip and composite utilities preserve the cutout after Tailwind compilation. Library, connection settings and Appearance share this material and the same hover tint. A separate inset outline appears for keyboard focus. In light mode, the Typography controls and Reading preview sit in neutral gray trays with white inset surfaces. Focus, drop targets and section dividers retain visible boundaries where they communicate interaction or structure.

Select menus use an opaque popover surface, a quiet theme-aware border and compact elevation so nearby fields do not show through or merge with the options. The selected row keeps its checkmark and a soft fill when focus moves elsewhere. Pointer hover raises text contrast and keyboard focus adds a visible outline. Menu options have compact heights and concentric corners that account for the 4 px inset and 1 px border.

Typography fields place a short label and current value on one line inside each borderless trigger. The filled control uses the card surface in light mode. Dark Library uses the secondary surface, and the embedded field uses a darker inset against the accordion tray. In the two-column layout, the controls and preview cards share the row height. The preview uses two Persian lines to show the spacing setting. At narrow widths the cards stack. Pointer hover raises the theme foreground from 75% to 100% over 120 ms while the field background stays steady. Enabled menu choices expose the pointer cursor and follow the same foreground treatment. The menus align to the trailing edge and use a bounded width. Font rows scroll above Add font, which opens the macOS file chooser directly. A font has a compact trash control when another usable font remains. Pointer hover changes the icon color. Trigger and menu labels stay on one line. In the host panel the confirmation appears as an animated popup near the panel. After confirmation, cancellation or file selection, focus returns to the Font control.

Toasts appear at the top center with a translucent popover surface, a status icon and an inline dismiss button. They use the same motion preferences as the rest of the manager. A checkmark confirms a successful operation, including a completed update check with no newer release. A download icon marks an available connection update. Partial font imports show a warning, and failed operations show a circled cross.

Rasta settings pairs the update and removal actions with live metadata. The update card shows the installed version and keeps any download or restart status near the action. The removal card shows the connected app count and opens a confirmation. The cards sit side by side when the settings panel is wide enough and stack in narrower windows.

## Product behavior

The Library card layout and independent app preferences remain. All apps and Connected are real collection filters. Empty Connected state returns to the full collection; asynchronous removal restores focus to the filter when its card disappears. Connection settings remain shadcn Dialogs with Reading and Connection tabs. Typography controls update the actual specimen. Download, verification, preparation and explicit Launch remain distinct. The installation view puts the existing four stages above the status surface. Compatibility advice appears inside that surface below progress, followed by the available installation or Launch actions. Omit the separate installation reassurance strip and duplicate working button. A completed removal returns to fresh installation controls, including when settings are reopened; the removal toast confirms the completed action.

This changes the manager interface only. Existing preview fixtures are retained; no additional supported app or distribution is introduced. Local preview actions are labeled as simulated. Native installation and release acceptance remain separate from browser UI review.

## Native window and shared host panel

The manager fills its window with one surface. A full-size transparent titlebar keeps the standard macOS window controls above the content without a second title or an inset web-page frame. The native header reserves vertical space for those controls while sharing the Library and card grid's horizontal inset. The complete eight-card catalog fits the default 940 × 780 window and the 720 × 780 minimum without page scrolling. Compact cards retain their inset action strip, independent switches and removal controls. Narrow browser previews can scroll so every card remains reachable. Preview controls open in a separate simulated-tools Dialog and do not add height to the overview. The manager version appears only in Rasta settings. The eight supported connections use their bundled provider icons.

The native application menu routes Command-Q through AppKit's normal Quit action, including when WebKit has keyboard focus. Standard Edit actions remain on the responder chain.

Supported chat surfaces use a 28 px Rasta button and the shared compact shadcn Dialog. The panel shows reading controls, Refresh and a link to Library. Refresh opens the matching connection when an update is available. The closed button retains its update dot on hosts that display one.

The panel uses a separate React root and a ShadowRoot so host styles and panel styles cannot reset each other. Its Dialog portal stays inside that root; fonts and layout units are isolated from the host's reading scale. Reading preferences are saved independently for each connection and shared between the host panel and Library. A visible host polls its own preferences every second and also refreshes on focus and visibility changes. Custom font faces are reused while the selection is unchanged. Host code, code blocks and terminal fonts retain their existing exclusions.

The app icon uses a black tile with three white strokes. The Library header,
launcher and reading panel use foreground and background colors from their
current appearance. Host controls keep their existing hover, focus and
expanded states around the mark. The package utility renders the app icon for
Finder and the Dock.

## Motion

Production CSS can shorten `220ms` to `.22s`; JavaScript converts either unit to milliseconds before calling Web Animations. Compiled UI tests run in Chromium and WebKit and verify the actual 220 ms marker and 500 ms sampled progress transition. A standalone WKWebView fixture also verified the marker in the native engine. Automated checks cover browser behavior; native installation acceptance still belongs to the user.

The motion pass follows Meng To's Animation Systems guidance on continuity, restrained transitions and visible feedback. Fast controls use 120 ms transitions, content and menus use 180 ms, dialogs and segmented indicators use 220 ms, and dialog exits use 140 ms. Movement uses a shared ease-out curve.

- Library and settings use a single entry on each navigation change. The selected marker travels between stable tab and appearance controls. Provider cards fade a single interaction surface while the footer transitions with it. The card tint uses 1.5% foreground in light mode and 4.5% in dark mode so hover, press, focus and selection preserve separation from the shell. The Settings button brightens on hover in both themes.
- Settings, font import, update and removal confirmations share dialog motion. Select enters from its anchor and releases focus immediately on dismissal. Tooltips use a short fade.
- Font import highlights the drop target, and the saved check confirms a successful preference change. Maintenance disclosure expands with its chevron. Alerts and toasts use short feedback transitions.
- The connection flow animates a completed check and fills its outgoing line. Phase text and available actions update at phase boundaries. Download samples move the progress bar linearly over the status polling interval. Phase changes use the shorter ease-out transition. The prepared state still waits for Launch.
- Reduced motion suppresses movement while preserving status and focus. Keyboard popup entry and selection are immediate. Activity indicators pause outside the visible viewport and when the document is hidden. Geometry observers for selection markers are disconnected when their surface unmounts.

## Meng To skill review

Reviewed all 182 locally installed MengTo/Skills entries using their installed purpose and scope. Source revision: `d6324a05ca03ce5f6cdba519318d92176dbc43d2`. Relevant skill instructions were read before applying them. The project-specific shadcn workflow also uses `crafted-shadcn-ui`.

The complete inventory below records why skills were selected, considered, or outside this product task. Reviewing a skill does not mean activating its deployment, delegation, service or asset-generation workflow.

| Skill | Decision |
| --- | --- |
| `audit-ai-design-slop` | Reviewed: use the implementation quality gate in no-ai-design-slop; a separate formal audit is not the requested deliverable. |
| `no-ai-design-slop` | Applied: remove the generic marketing headline, retain real app identity and state, and avoid decorative effects without a task. |
| `design-first-ui-prompting` | Applied: define one reference-based hierarchy, type scale, palette and material system before implementation. |
| `3d-high-poly-models` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-cloth-material` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-paper-material` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-virtual-tour` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-sky-rays` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-orbit-inspect-demo` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-metal-material` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-ultra-realistic-water` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-four-seasons` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-falling-leaves` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-underwater-god-rays` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-wood-lighting-scorecard` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-sky-background` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-retina-resolution` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-high-resolution-textures` | Outside scope: this manager has no 3D scene or material pipeline. |
| `3d-wood-material` | Outside scope: this manager has no 3D scene or material pipeline. |
| `funky-purple-container-tech` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `scroll-scrubbed-visual-sequence` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `tech-green-dark-mode-modern` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `dither-background` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `fire-paper-loader` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `skeuomorphic-ui` | Reviewed: full physical materials and embossed treatment exceed the references; use restrained nested surfaces instead. |
| `build-interactive-particle-trail` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `animation-on-scroll` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `dark-blue-contrasting-clean` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `threejs-landscape` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `pricing-page` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `build-awwwards-quality-sites` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `masked-reveal` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `corner-diagonals` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `solar-duotone-bold` | Reviewed: retain the existing Lucide icon system for consistency. |
| `vantajs` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `build-threejs-scroll-worlds` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `html-demo` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `shaders-cursor-ripples` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `blue-laser-clean-glass-layout` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `scroll-scrubbed-word-reveal` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `add-mouse-driven-orbit` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `product-proof-saas` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `technical-wireframe-info-layout` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `threejs-weather` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `thinking-orbs` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `horizontal-scroll-scenes` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `editorial-portfolio-chapters` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `marquee-loop` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `dither-laser-dark-mode` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `gooey-blob-system` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `framed-tech-dark-border-gradient` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `editorial-service-booking` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `cinematic-gsap-lenis-motion-system` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `scroll-world-storytelling` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `high-contrast-skeuomorphic-clean` | Applied selectively: nested charcoal surfaces, inset controls and restrained edges; adapt to the existing light and dark themes. |
| `beam-glow-states` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `build-wireframe-scan-reveal` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `background-grid-webgl` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `scroll-progress-timeline` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `threejs-towers` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `ambient-section-particles` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `operational-enterprise-ai` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `glass-dark-ui` | Applied: frosted popup material and translucent segmented markers with a directional sheen and masked rim. |
| `add-shader-cursor-trail` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `dark-glass-clean-layout` | Applied: layer surfaces with tonal depth and keep borders selective. |
| `liquid-metal-border` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `light-mode-paper-technical` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `clean-minimal-beige-light-mode` | Reviewed: quiet tonal separation is relevant, but beige coloration does not match the supplied achromatic references. |
| `blue-cloudy-clean-modern` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `webgl-3d-object` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `unicorn-studio` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `globe-gl` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `beautiful-shadows` | Applied as a principle: layered neutral elevation, scaled into shared control, panel and dialog shadow tokens. |
| `editorial-tech` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `nested-container-clean-agency` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `glass-dark-mode-clock` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `webgl-landing-steering` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `orange-clean-paper-saas` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `landing-page` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `animation-systems` | Applied: shared timing, selection continuity, purposeful state changes and reduced motion. |
| `corner-lasers` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `image-first-grid-layout` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `matterjs` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `css-alpha-masking` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `gsap-scrolltrigger-storytelling` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `pointer-trail-emitter` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `agency-grid-layout-minimal` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `gsap` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `container-lines` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `paper-cinder-transition` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `atmosphere-background` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `split-layout-technical` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `staggered-word-reveal` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `reveal-hover-effect` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `nested-container-frames` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `progressive-blur` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `tailwindcss` | Applied: semantic theme tokens and Tailwind composition throughout the existing React and shadcn interface. |
| `bright-green-tech-system-webgl` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `company-logos` | Reviewed: retain the existing bundled authentic provider logos; no replacement or network dependency needed. |
| `globe-particles` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `number-details` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `css-border-gradient` | Applied: a restrained masked gradient rim on selected segments, with separate light and dark tokens. |
| `book-serif-index` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `documentary-brutalist-agency` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `cinematic-scroll-storytelling` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `webgl-laser` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `threejs` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `cobejs` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `falling-leaves` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `framed-grid-layout` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `mesh-gradient-dark-blue-clean` | Not selected: its specialized visual, motion, publishing or content workflow is not needed for this compact reference-based utility. |
| `web-technique-to-skill` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `optimize-web-animations` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `publish-project-to-github` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `generate-reference-inspired-brand-worlds` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `elevenlabs-tts` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `audit-reference-originality` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `video-to-superprompt` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `html-to-interaction-prompts` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `performance-profiling` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `codex-gpt-image-2-5-flare` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `iterate-until-verified` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `audit-verify-explain-grade-5` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `implement-fog-of-war` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `stitched-full-page-capture` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `write-like-meng-on-x` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `browser-video-recording` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `x-bookmark-quote-posts` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `article-prompts-to-skills` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `daily-ui-inspiration-capture` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `build-daily-inspiration-sites` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-teal-spot` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-one-line` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-halftone-line` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-line-interior` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-vintage-emblem` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-grainy-gouache` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-flat-with-black` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-isometric-mono` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-ink-sketch` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-framed-panel` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-outlined-cartoon` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-two-colour-brush` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-flat` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `illustration-bold-pop` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `workflow-score-to-target` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `workflow-threads-manager` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `workflow-ship-change` | Reviewed: local UI work is authorized; project instructions defer pushes, app packaging and publication. |
| `workflow-progress-screenshots` | Reviewed: capture and inspect actual browser states during implementation. |
| `water-crystal-skill-vfx` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `game-dev-combat-skill-polish` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `lightning-energy-skill-vfx` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `ice-frost-skill-vfx` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `game-dev-combat-animation` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `fire-smoke-skill-vfx` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-mobile-threejs-games` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-game-map-editor` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `ship-web-games` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `optimize-threejs-games` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-hybrid-game-assets` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-isometric-arpg` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-threejs-enemy-systems` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-game-inventory` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-game-audio-feedback` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `test-playable-web-games` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-game-monster-system` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `create-game-vfx` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `design-action-combat` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-vesperfall-review-assets` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `design-game-encounters` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `author-game-levels` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-game-changelog` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-rigged-game-assets` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `tune-enemy-ai` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `build-game-camera-controls` | Outside scope: gameplay, game assets and game tooling are not part of this manager redesign. |
| `aura-asset-images` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `html-explainer-video` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `url-to-motion-design` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `create-ai-avatar` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `html-reel` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `unsplash-asset-images` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |
| `digital-twin` | Not selected: its specialized media, illustration, content or workflow capability is outside the requested manager interface. |


## Installation and recovery copy

Use **Rasta app** for the manager and **Rasta for {app}** for a host connection.
Use the verbs Install, Update, Repair and Remove. Keep runtime paths, adapter
names and feed implementation details in diagnostics. Use structured service
reason codes for user-facing recovery guidance.

Name the host version when the user needs to update the vendor app. When a
verified Rasta package does not support the host, say compatibility requires a
Rasta update. Give network and verification failures their own messages and
retry actions. A failed offline check leaves compatibility unconfirmed. Keep
download percentages out of blocked states. Successful preparation points to
Launch and describes the host restart. Keep removal failures tied to the
removal operation. Refer to the [architecture](installer-architecture.md) for
the separation between installation, offline repair and recovery.
