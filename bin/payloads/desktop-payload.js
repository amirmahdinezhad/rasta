/* RASTA PRO PATCH - SMART RTL PAYLOAD */
/* Ported from antigravity-pro-rtl's ide-payload.js for Codex and T3 Code.
 * Engine unchanged: MutationObserver + requestAnimationFrame, zero-delay.
 * Namespaced with the `artl-` prefix so it never collides with other
 * patchers. Chat selectors generalized beyond Monaco for React/Vite UIs
 * (Codex webviews and T3 ChatMarkdown/ChatView).
 */
(function() {
    if (window.__rastaPro && !window.__rastaPro.disabled) return;
    const STORAGE_KEY = 'rasta-config';
    const AGENT_VERSION = /* __ARTL_VERSION__ */ '';
    const HOST_TARGET = /* __ARTL_TARGET__ */ '';
    const CHAT_TARGET = HOST_TARGET || (window.location?.protocol === 't3code:' ? 't3'
        : window.location?.protocol === 'https:' && window.location?.hostname === '127.0.0.1' ? 'antigravity' : 'codex');
    const HOST_NAME = ({ codex: 'Codex', t3: 'T3 Code', antigravity: 'Antigravity', claude: 'Claude', opencode: 'OpenCode', zcode: 'ZCode', grokbot: 'Grok Bot' })[CHAT_TARGET];
    // These selectors come from the inspected desktop renderers and remain host-scoped.
    const DESKTOP_SCOPE = HOST_TARGET === 'antigravity' ? '[data-testid="agent-response"], [data-testid="user-message-content"]'
        : HOST_TARGET === 'claude' ? '[data-testid="user-message"], [data-testid="assistant-message"], [data-cds="AssistantMessage"], [data-turn-key]'
        : HOST_TARGET === 'opencode' ? '[data-component="markdown"], [data-component="user-message"], [data-component="prompt-input"]'
        : HOST_TARGET === 'grokbot' ? '.sand-message-prose, .sand-chat-input-dock [contenteditable]'
        : HOST_TARGET === 'zcode' ? '[data-turn-id], [data-turn-key]' : '';
    const readingDefaults = __READING_DEFAULTS__;
    let rtlConfig = { faFont: '', enFont: '', codeFont: '', ...readingDefaults };
    try { rtlConfig = { ...rtlConfig, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch {}
    rtlConfig.fs = ['14', '16', '18'].includes(String(rtlConfig.fs)) ? String(rtlConfig.fs) : readingDefaults.fs;
    rtlConfig.lh = ['1.4', '1.6', '1.8'].includes(String(rtlConfig.lh)) ? String(rtlConfig.lh) : readingDefaults.lh;

    // Baked at patch time: Persian Regular fonts (plain + FaNum models) and
    // bundled English fonts. Stale/empty saved values fall back here.
    const bundledPersianFonts = __FA_FONTS__, bundledEnglishFonts = __EN_FONTS__;
    if (!bundledPersianFonts.some(font => font.value === rtlConfig.faFont)) rtlConfig.faFont = __DEFAULT_FA__;
    if (!bundledEnglishFonts.some(font => font.value === rtlConfig.enFont)) rtlConfig.enFont = __DEFAULT_EN__;

    let isRTL = rtlConfig.isRTL;
    let forceRTL = isRTL && rtlConfig.forceRTL;
    let updatePoll = null, updateCheck = null;
    let updatesDisposed = false;
    let closeWidget = null, closeMenu = null, closeConfirmation = null, disposeTheme = null, disposeFonts = null, toastTimer = null, toastExitTimer = null;
    let appFontOverride = '';

    function injectStyle(id, css) {
        let style = document.getElementById(id);
        if (!style) {
            style = document.createElement('style');
            style.id = id;
            document.head.appendChild(style);
        }
        style.textContent = css;
    }

    const staticCSS = `
        __FONT_FACES__
        /* The host shortcut stays outside the isolated shadcn panel. */
        .artl-widget-container { --artl-base:#fff; --artl-text:#242424; --artl-muted:#606060; --artl-accent:#303030; --artl-ink:#303030; --artl-line:#e2e2e2; --artl-soft:#e8e8e8; --artl-panel-trigger:#dedede; --artl-panel-trigger-hover:#e7e7e7; --artl-panel-trigger-open:#f0f0f0; position:fixed; bottom:16px; right:16px; z-index:999999; font:13px/1.5 system-ui,sans-serif; }
        .artl-widget-container[hidden], .artl-widget-container [hidden] { display:none!important; }
        .artl-widget-trigger { position:relative; display:flex; align-items:center; gap:8px; min-height:32px; padding:6px 10px; border:1px solid var(--artl-line); border-radius:11px; background:var(--artl-base); color:var(--artl-text); cursor:pointer; box-shadow:0 1px 3px #00000012; font:inherit; transition:transform 120ms cubic-bezier(.22,1,.36,1),background-color 120ms ease,color 120ms ease,opacity 120ms ease; }
        .artl-widget-trigger svg { width:18px; height:18px; color:inherit; }
        .artl-widget-trigger:not([data-panel])[data-active=false] { color:var(--artl-muted); background:var(--artl-soft); }
        .artl-widget-trigger:where(:not([data-keyboard=true])):active { transform:scale(.97); }
        .artl-widget-trigger:not([data-panel]):focus-visible { outline:2px solid var(--artl-accent); outline-offset:3px; }
        .artl-update-badge { width:5px; height:5px; border-radius:50%; background:var(--artl-accent); }
        .artl-widget-trigger[data-panel] .artl-update-badge { position:absolute; right:-2px; top:-2px; box-shadow:0 0 0 2px var(--artl-base); }
        .artl-quick-error { max-width:240px; padding:8px 12px; background:var(--artl-base); color:var(--artl-text); border:1px solid var(--artl-line); border-radius:10px; }
        @media(prefers-color-scheme:dark) { .artl-widget-container { --artl-base:#1c1c1c; --artl-text:#f2f2f2; --artl-muted:#a3a3a3; --artl-accent:#e8e8e8; --artl-ink:#e8e8e8; --artl-line:#333; --artl-soft:#303030; --artl-panel-trigger:#242424; --artl-panel-trigger-hover:#2c2c2c; --artl-panel-trigger-open:#343434; } }
        :root:is(.dark,[data-theme="dark"]) .artl-widget-container { --artl-base:#1c1c1c; --artl-text:#f2f2f2; --artl-muted:#a3a3a3; --artl-accent:#e8e8e8; --artl-ink:#e8e8e8; --artl-line:#333; --artl-soft:#303030; --artl-panel-trigger:#242424; --artl-panel-trigger-hover:#2c2c2c; --artl-panel-trigger-open:#343434; }
        :root:is(.light,[data-theme="light"]) .artl-widget-container { --artl-base:#fff; --artl-text:#242424; --artl-muted:#606060; --artl-accent:#303030; --artl-ink:#303030; --artl-line:#e2e2e2; --artl-soft:#e8e8e8; --artl-panel-trigger:#dedede; --artl-panel-trigger-hover:#e7e7e7; --artl-panel-trigger-open:#f0f0f0; }
        @media(hover:hover)and(pointer:fine) { .artl-widget-trigger:not([data-panel]):hover { background:var(--artl-soft); } }
        /* The trigger lives in the vendor document, outside the Tailwind shadow root. */
        .artl-widget-trigger[data-panel] { width:28px; min-height:28px; height:28px; padding:4px; border-radius:9px; border:0; outline:0; box-shadow:none; background:var(--artl-panel-trigger); opacity:.84; }
        .artl-widget-trigger[data-panel][data-active=false] { color:var(--artl-muted); }
        .artl-widget-trigger[data-panel][data-active=false] svg { opacity:.72; }
        @media (hover: hover) { .artl-widget-trigger[data-panel]:hover { background:var(--artl-panel-trigger-hover); opacity:.94; } }
        .artl-widget-trigger[data-panel][aria-expanded=true] { background:var(--artl-panel-trigger-open); }
        .artl-widget-trigger[data-panel]:is(:focus,[aria-expanded=true]) { opacity:1; }
        @media(prefers-reduced-motion:reduce) { .artl-widget-trigger { transition:none; } .artl-widget-trigger:active { transform:none; } }
    `;
    injectStyle('artl-widget-style', staticCSS);

    function updateAppFontCSS(family) {
        if (!isRTL) { document.getElementById('artl-app-font-style')?.remove(); return; }
        const stack = [family, 'Vazir'].filter((value, index, all) => value && all.indexOf(value) === index)
            .map(value => JSON.stringify(value)).join(', ') + ', system-ui, sans-serif';
        // Keep code, terminal output and font-based icons on their host stacks.
        injectStyle('artl-app-font-style', `
            :root { --artl-app-font: ${stack} !important; --font-sans: ${stack} !important; --font-family-sans: ${stack} !important; --vscode-font-family: ${stack} !important; }
            body, body :where(*):not(:where(pre, pre *, code, code *, kbd, kbd *, samp, samp *,
                .monaco-editor, .monaco-editor *, .xterm, .xterm *, .terminal, .terminal *,
                [class*="font-mono"], [class*="font-mono"] *, [class*="codicon"], [class*="codicon"] *,
                .material-icons, .material-icons *, .material-symbols-outlined, .material-symbols-outlined *, svg, svg *)) {
                font-family: ${stack} !important;
            }
        `);
    }

    function updateDynamicCSS(faFont, enFont, codeFont, lh, fs) {
        // Distinct Latin families take precedence; shared Vazir is embedded once.
        const families = (appFontOverride ? [appFontOverride, 'Vazir'] : [enFont, faFont]).filter((family, index, list) => family && list.indexOf(family) === index);
        const stack = families.map(family => `'${family.replace(/'/g, "\\'")}', `).join('') + 'ui-sans-serif, system-ui, sans-serif, "Segoe UI Emoji"';

        const dynamicCSS = `
            :root {
                --vscode-font-family: ${stack} !important;
            }
            ${DESKTOP_SCOPE ? DESKTOP_SCOPE + ',' : ''}
            .artl-text-node,
            .monaco-chat-request,
            .monaco-chat-response,
            .interactive-input-part,
            .chat-input-part,
            [class*="ChatMarkdown"],
            [class*="ChatView"],
            [class*="chat-message"],
            [class*="thread-"],
            [data-user-message-body],
            [data-user-message-bubble],
            .rich-text-user-turn,
            [data-timeline-root],
            [data-timeline-row-id],
            [data-message-id],
            [data-message-role],
            [data-markdown-text-style],
            [data-markdown-copy],
            [data-codex-composer] .ProseMirror,
            [data-codex-composer-request-navigation],
            form[data-codex-character-input-boundary][data-codex-escape-boundary],
            [data-mcp-form-choices],
            [data-assistant-citation-viewport],
            [data-testid="composer-editor"],
            .composer-tiptap,
            .ProseMirror,
            .vertical-scroll-fade-mask [data-tooltip-overflow-target],
            :is([role="dialog"], [role="tooltip"]) .overscroll-contain.whitespace-pre-wrap,
            [data-queued-message-id],
            [data-queued-message-id] .whitespace-pre-wrap {
                font-family: ${stack} !important;
                font-size: ${fs}px !important;
                line-height: ${lh} !important;
            }
            .monaco-chat-request .value,
            .interactive-session .value {
                font-family: inherit !important;
                font-size: inherit !important;
            }
        `;
        if (isRTL) injectStyle('artl-rtl-style', dynamicCSS);
    }
    updateDynamicCSS(rtlConfig.faFont, rtlConfig.enFont, rtlConfig.codeFont, rtlConfig.lh, rtlConfig.fs);

    function createRastaMark() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 32 32');
        svg.setAttribute('stroke', 'none');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M7 6h19v5H7a2.5 2.5 0 0 1 0-5Zm6 8h13v5H13a2.5 2.5 0 0 1 0-5Zm6 8h7v5h-7a2.5 2.5 0 0 1 0-5Z');
        svg.appendChild(path);
        return svg;
    }
    /* __RASTA_CONNECTION_PANEL__ */

    const chatSelectors = {
        codex: '[data-codex-composer], .thread-scroll-container',
        t3: '[data-chat-canvas], [data-chat-composer-main-surface], .messages-timeline-scroll',
        antigravity: '[data-testid="agent-input-box"], [id="antigravity.agentSidePanelInputBox"], [data-testid="agent-response"], [data-testid="user-message-content"]',
        claude: '#prompt-textarea, [contenteditable="true"].tiptap.ProseMirror, [data-testid="assistant-message"], [data-cds="AssistantMessage"], [data-testid="user-message"]',
        opencode: '[data-component="session-composer-dock"], [data-slot="new-session-composer"], [data-component="prompt-input"]',
        zcode: '[data-v4-composer-dock], [data-turn-id][data-turn-key]',
        grokbot: '.sand-chat-input-dock, .sand-message-prose',
    };
    const hostSettings = {
        antigravity: '.settings-modal-container',
        opencode: '[data-component="dialog-v2"]',
        zcode: '[data-settings-content-frame]',
        grokbot: '.sand-settings-dialog',
    };
    function visible(element, ariaHidden) {
        return !element.closest(`[hidden], [inert], ${ariaHidden}, [data-app-shell-active-page="false"]`)
            && [...element.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)
            && getComputedStyle(element).visibility === 'visible';
    }
    function isChatSurface() {
        const selector = chatSelectors[CHAT_TARGET];
        if (!selector) return false;
        const pathname = window.location.pathname;
        if (CHAT_TARGET === 'claude' && !/^\/(?:new\/?|chat\/[^/]+\/?)?$/.test(pathname)) return false;
        if (CHAT_TARGET === 't3' && /^\/(?:settings|pull-requests)(?:\/|$)/.test(pathname)) return false;
        // Radix hides the host from assistive technology while a panel popup is open.
        // Those temporary attributes do not mean the host left its chat surface.
        const ownPopup = widget?.querySelector('div')?.shadowRoot?.querySelector(
            '[data-slot="select-content"], [data-slot="dropdown-menu-content"], [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"]');
        const ariaHidden = ownPopup ? '[aria-hidden="true"]:not([data-aria-hidden])' : '[aria-hidden="true"]';
        const modalSelector = ['dialog[open]', '[aria-modal="true"]', hostSettings[CHAT_TARGET]].filter(Boolean).join(', ');
        if ([...document.querySelectorAll(modalSelector)].some(element => visible(element, ariaHidden))) return false;
        return [...document.querySelectorAll(selector)].some(element => visible(element, ariaHidden));
    }

    let widget = null;
    const widgetObserver = new MutationObserver(mutations => {
        if (mutations.some(mutation => !widget?.contains(mutation.target))) syncWidgetVisibility();
    });
    function syncWidgetVisibility() {
        if (!widget) return;
        const hidden = !isChatSurface();
        if (widget.hidden === hidden) return;
        widget.hidden = hidden;
        if (hidden) closeWidget?.(true);
    }

    let disposePanel = null;
    function createWidget() {
        if (document.querySelector('.artl-widget-container')) return;
        const container = document.createElement('div'); container.className = 'artl-widget-container';
        widget = container;
        container.hidden = true;
        const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'artl-widget-trigger'; trigger.hidden = true;
        trigger.setAttribute('aria-label', 'Rasta update available. Open Rasta'); trigger.title = 'Open the Rasta app to update Rasta for ' + HOST_NAME;
        const hasPanel = typeof RastaConnectionPanel !== 'undefined' && typeof window.rastaNative?.saveReading === 'function';
        trigger.appendChild(createRastaMark());
        if (hasPanel) {
            trigger.hidden = false; trigger.setAttribute('data-panel', 'true'); trigger.setAttribute('aria-label', 'Open Rasta panel'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.title = 'Rasta';
        }
        const copy = document.createElement('span'); copy.textContent = 'Rasta update'; copy.hidden = hasPanel; trigger.appendChild(copy);
        const badge = document.createElement('span'); badge.className = 'artl-update-badge'; badge.hidden = hasPanel; badge.setAttribute('aria-hidden', 'true'); trigger.appendChild(badge);
        const error = document.createElement('p'); error.className = 'artl-quick-error'; error.hidden = true; error.setAttribute('role', 'status');
        container.appendChild(trigger); container.appendChild(error); document.body.appendChild(container);
        trigger.onkeydown = () => trigger.setAttribute('data-keyboard', 'true');
        trigger.onpointerdown = () => trigger.removeAttribute('data-keyboard');
        let panel = null, latestUpdate = {}, fontSettings = { selected: 'vazir', fonts: [], active: null };
        const readingSettings = () => {
            const { isRTL, forceRTL, fixAtSign, fs, lh } = rtlConfig;
            return { isRTL, forceRTL, fixAtSign, fs, lh };
        };
        const syncPanel = () => {
            const reading = readingSettings();
            panel?.update({ update: latestUpdate, preferences: { ...fontSettings, reading } });
        };
        if (hasPanel) {
            const panelHost = document.createElement('div'); container.appendChild(panelHost);
            panel = RastaConnectionPanel.mount(panelHost, trigger, {
                name: HOST_NAME,
                check: async () => { const value = await window.rastaNative.check(); showUpdate(value); return value; },
                openManager: () => window.rastaNative.openManager(),
                chooseFonts: window.rastaNative.chooseFonts,
                changePreferences: async ({ action, input }) => {
                    if (action === 'reading-save') {
                        const [key, value] = Object.entries(input)[0];
                        const reading = await window.rastaNative.saveReading(key, value, readingSettings());
                        if (!updatesDisposed) {
                            readingRevision++;
                            previous = '';
                            applyReading(reading);
                        }
                        return;
                    }
                    let saved;
                    if (action === 'font-remove') saved = await window.rastaNative.removeFont(input.id);
                    else if (action === 'font-select') saved = await window.rastaNative.selectFont(input.id);
                    else saved = await window.rastaNative.importFont(input.name, input.data);
                    previous = '';
                    await applyFontPreferences(saved, ++readingRevision);
                },
            });
            syncPanel();
            closeWidget = surfaceChanged => panel.close(surfaceChanged); disposePanel = () => panel.dispose();
        }
        trigger.onclick = async () => {
            if (!isChatSurface()) return;
            if (panel) { panel.toggle(); return; }
            trigger.disabled = true; error.hidden = true;
            try { await window.rastaNative.openManager(); }
            catch { error.textContent = 'Could not open the Rasta app. Open it from Applications and select ' + HOST_NAME + '. If Rasta is missing, install it first.'; error.hidden = false; }
            finally { if (!updatesDisposed) trigger.disabled = false; }
        };
        let checking = false;
        const showUpdate = value => {
            if (updatesDisposed || value?.releaseError) return;
            latestUpdate = value || {};
            const available = !!(value?.available && value.release);
            if (panel) {
                badge.hidden = !available;
                trigger.setAttribute('aria-description', available ? 'A Rasta update is available for ' + HOST_NAME + '.' : 'Open reading status and Rasta updates.');
                syncPanel();
            } else trigger.hidden = !available;
        };
        async function check() {
            if (checking || updatesDisposed || typeof window.rastaNative?.check !== 'function') return;
            checking = true;
            try { showUpdate(await window.rastaNative.check()); } catch {} finally { checking = false; }
        }
        let refreshing = false, previous = '', face = null, readingRevision = 0;
        const bundledFaces = [];
        const fontFromData = (family, data) => new window.FontFace(family,
            Uint8Array.from(window.atob(data), character => character.charCodeAt(0)).buffer);
        async function loadBundledFaces() {
            if (bundledFaces.length) return;
            // Binary sources do not initiate a URL load. Respect the host's CSP
            // without requiring data: or a new remote font origin in font-src.
            for (const face of __BUNDLED_READING_FACES__) {
                const loaded = await fontFromData(face.family, face.data).load();
                if (updatesDisposed) return;
                document.fonts.add(loaded); bundledFaces.push(loaded);
            }
        }
        function applyReading(reading, family = appFontOverride) {
            const previousLayout = [isRTL, forceRTL, rtlConfig.fs, rtlConfig.lh, appFontOverride];
            if (reading) {
                for (const key of ['isRTL', 'forceRTL', 'fixAtSign']) if (typeof reading[key] === 'boolean') rtlConfig[key] = reading[key];
                if (['14', '16', '18'].includes(reading.fs)) rtlConfig.fs = reading.fs;
                if (['1.4', '1.6', '1.8'].includes(reading.lh)) rtlConfig.lh = reading.lh;
            }
            appFontOverride = family;
            isRTL = rtlConfig.isRTL;
            forceRTL = isRTL && rtlConfig.forceRTL;
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rtlConfig)); } catch {}
            syncPanel();
            if ([isRTL, forceRTL, rtlConfig.fs, rtlConfig.lh, appFontOverride].every((value, index) => value === previousLayout[index])) return;
            clearDir(); updateAppFontCSS(family || rtlConfig.enFont);
            if (isRTL) { updateDynamicCSS(rtlConfig.faFont, rtlConfig.enFont, '', rtlConfig.lh, rtlConfig.fs); updateDir(); }
            else { document.getElementById('artl-rtl-style')?.remove(); messageDirections?.sync(); }
        }
        async function applyFontPreferences(saved, revision) {
            if (updatesDisposed || revision !== readingRevision) return;
            const { selected, fonts, active, vazirRemoved } = saved;
            let family = selected === 'vazir' ? 'Vazir' : '';
            if (active?.id === selected && /^[a-f0-9]{32}$/.test(selected) && typeof active.data === 'string' && active.data.length <= 2796204 && /^[A-Za-z0-9+/]+=*$/.test(active.data)) {
                family = 'RastaUser_' + selected;
                if (face?.family !== family) {
                    let next;
                    try { next = await fontFromData(family, active.data).load(); }
                    catch { throw new Error('This font could not be loaded. Choose another font.'); }
                    if (updatesDisposed || revision !== readingRevision) return;
                    if (face) document.fonts.delete(face);
                    document.fonts.add(next);
                    face = next;
                }
            } else if (face) { document.fonts.delete(face); face = null; }
            fontSettings = { selected, fonts, active, vazirRemoved };
            applyReading(saved.reading, family);
        }
        async function refreshPreferences() {
            if (refreshing || updatesDisposed || typeof window.rastaNative?.preferences !== 'function') return;
            refreshing = true;
            const revision = readingRevision;
            try {
                const saved = await window.rastaNative.preferences(), signature = JSON.stringify(saved);
                if (updatesDisposed || revision !== readingRevision || signature === previous) return;
                await loadBundledFaces();
                await applyFontPreferences(saved, revision);
                if (updatesDisposed || revision !== readingRevision) return;
                previous = signature;
            } catch {} finally { refreshing = false; }
        }
        const focus = () => { refreshPreferences(); window.rastaNative?.status?.().then(value => { if (!updatesDisposed) showUpdate(value.update); }).catch(() => {}); };
        window.addEventListener('focus', focus);
        const visible = () => { if (!document.hidden) focus(); };
        document.addEventListener('visibilitychange', visible);
        const poll = setInterval(() => { if (!document.hidden) refreshPreferences(); }, 1000);
        disposeFonts = () => { clearInterval(poll); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible); if (face) document.fonts.delete(face); for (const face of bundledFaces) document.fonts.delete(face); };
        focus(); check(); updateCheck = setInterval(check, 4 * 3600000);
        updateAppFontCSS(rtlConfig.enFont);
        widgetObserver.observe(document.body, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ['hidden', 'inert', 'aria-hidden', 'aria-modal', 'open', 'class', 'style',
                'data-app-shell-active-page', 'data-codex-composer', 'data-chat-canvas', 'data-chat-composer-main-surface',
                'id', 'data-testid', 'data-component', 'data-slot', 'data-v4-composer-dock', 'data-turn-id', 'data-turn-key', 'data-settings-content-frame'],
        });
        syncWidgetVisibility();
    }

    const featureFailures = [];
    let onOutsideClick;
    if (document.body) createWidget();
    else window.addEventListener('DOMContentLoaded', createWidget, { once: true });

    /* __CODEX_MESSAGE_DIRECTIONS__ */
    let messageContext = null, messageDirections = null;
    try {
        const options = { document, window, changed: () => updateDir(), target: HOST_TARGET, visible, isChatSurface };
        if (window.location?.protocol === 't3code:') messageContext = createT3MessageContext(options);
        else if (HOST_TARGET === 'codex' || !HOST_TARGET || HOST_TARGET === 't3') messageContext = createCodexMessageContext(options);
        else messageContext = createDesktopMessageContext(options);
    }
    catch { featureFailures.push('message-context'); }
    try {
        if (messageContext && typeof createCodexMessageDirections === 'function') messageDirections = createCodexMessageDirections({ document, window, context: messageContext, enabled: () => isRTL && !forceRTL,
            refresh: () => updateDir(), createRastaMark, defaultDirection: (el, text) => defaultTextDirection(el, readingText(text)) });
    } catch { featureFailures.push('message-directions'); }

    // Elements we have touched, tracked explicitly so clearDir() can undo them
    // even if React later rewrites their className and drops our marker class.
    const directedNodes = new Map();

    // The chat / typing environment: conversation text, the composer, and the
    // pending question / approval surfaces (option buttons + custom-answer
    // prompt) that T3 renders inside the composer. Force RTL must stay inside
    // this scope so the app chrome (sidebar, toolbar, menus) keeps its own
    // direction.
    // T3 v0.0.44 moved assistant messages into a virtualized timeline with no
    // ChatMarkdown/chat-message classes: rows carry data-timeline-row-id +
    // data-message-id / data-message-role under [data-timeline-root], user
    // bubbles carry [data-user-message-body], and the composer is TipTap
    // (.composer-tiptap / .ProseMirror / [data-testid="composer-editor"]).
    // All of them are listed here; legacy selectors are kept for older builds
    // across supported app views.
    const CONTENT_SCOPE = '.chat-markdown, [class*="ChatMarkdown"], [class*="chat-message"], [data-user-message-body], [data-user-message-footer], [data-timeline-root], [data-timeline-row-id], [data-message-id], [data-message-role], [data-assistant-citation-viewport], [data-queued-message-id], [data-testid="composer-editor"], [data-composer-rich-text], .composer-tiptap, .ProseMirror, [contenteditable="true"], textarea, .monaco-chat-request, .monaco-chat-response, .interactive-input-part, .chat-input-part, .interactive-session, [data-chat-composer-surface], [data-chat-composer-body], [data-chat-composer-main-surface], [data-chat-composer-top-drawer], [data-chat-composer-overlay], [data-chat-composer-tasks-drawer], [data-pending-user-input-toggle], [data-approval-detail]';

    // Sent messages use rich-text-user-turn and a bubble, while MCP questions
    // use a form boundary instead of the main composer's request attribute.
    const CODEX_MESSAGE_SCOPE = '[data-user-message-bubble], .rich-text-user-turn';
    // Codex's queue uses a clipped markdown preview instead of T3's queued
    // message IDs. Its full-text preview is rendered in a separate portal.
    const CODEX_QUEUE_SCOPE = '.vertical-scroll-fade-mask [data-tooltip-overflow-target], :is([role="dialog"], [role="tooltip"]) .overscroll-contain.whitespace-pre-wrap';
    const CODEX_QUESTION_SCOPE = '[data-codex-composer-request-navigation], form[data-codex-character-input-boundary][data-codex-escape-boundary], [data-mcp-form-choices]';
    const CODEX_CONTENT_SCOPE = `[data-markdown-text-style], [data-markdown-copy], [data-codex-composer], ${CODEX_MESSAGE_SCOPE}, ${CODEX_QUESTION_SCOPE}, ${CODEX_QUEUE_SCOPE}`;
    const CODEX_FORCE_SCOPE = `[data-markdown-text-style], [data-markdown-copy], ${CODEX_MESSAGE_SCOPE}, ${CODEX_QUESTION_SCOPE}, ${CODEX_QUEUE_SCOPE}`;

    function inContentScope(el) {
        return !!(el.closest && el.closest(`${CONTENT_SCOPE}, ${CODEX_CONTENT_SCOPE}${DESKTOP_SCOPE ? ", " + DESKTOP_SCOPE : ""}`));
    }

    // Forced RTL is scoped to readable content: the message transcript, the
    // pending/approval cards and the actual typed text (editor, fields).
    // Composer chrome (model bar, send row, footer toolbar, resting controls)
    // is deliberately NOT listed, so turning on Force RTL never flips the
    // prompt section layout — chrome keeps auto direction.
    const FORCE_SCOPE = '.chat-markdown, [class*="ChatMarkdown"], [class*="chat-message"], [data-user-message-body], [data-user-message-footer], [data-timeline-root], [data-timeline-row-id], [data-message-id], [data-message-role], [data-assistant-citation-viewport], [data-queued-message-id], [data-testid="composer-editor"], [data-composer-rich-text], .composer-tiptap, .ProseMirror, [contenteditable="true"], textarea, input, .monaco-chat-request, .monaco-chat-response, .interactive-input-part, .chat-input-part, .interactive-session, [data-chat-composer-top-drawer], [data-chat-composer-tasks-drawer], [data-pending-user-input-toggle], [data-approval-detail]';

    function inForceScope(el) {
        return !!(el.closest && el.closest(`${FORCE_SCOPE}, ${CODEX_FORCE_SCOPE}${DESKTOP_SCOPE ? ", " + DESKTOP_SCOPE : ""}`));
    }

    function readingText(raw) {
        return (raw || '').replace(/[\u0600-\u060f\ufeff]/g, '').trim();
    }

    function defaultTextDirection(el, text) {
        if (forceRTL && inForceScope(el)) return 'rtl';
        const firstChar = text.match(/[A-Za-z\u0600-\u06ff]/)?.[0];
        if (!firstChar) return 'auto';
        return /[\u0600-\u06ff]/.test(firstChar) ? 'rtl' : 'ltr';
    }

    function updateDir() {
        try { messageDirections?.sync(); }
        catch { try { messageDirections?.dispose?.(); } catch {} messageDirections = null; featureFailures.push('message-directions'); }
        if (!isRTL) return;

        const allElements = document.querySelectorAll('*');
        const textElements = [];
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const tag = el.tagName;

            // BUTTON carries multi-choice option labels (and the "type your own
            // answer" prompt): directing it flips its flex row so the icon /
            // checkmark moves to the right and the text right-aligns.
            if (['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'BLOCKQUOTE', 'TD', 'TH', 'BUTTON', 'LABEL', 'LEGEND', 'TEXTAREA'].includes(tag)) {
                textElements.push(el);
                continue;
            }
            // A question choice is a flex row containing its marker and label.
            // Direct the semantic row too, so the marker follows RTL text even
            // when the app renders a DIV instead of a BUTTON or LABEL.
            if (['radio', 'checkbox'].includes(el.getAttribute('role')) && el.closest(CODEX_QUESTION_SCOPE)) {
                textElements.push(el);
                continue;
            }
            if (tag === 'INPUT') {
                const type = (el.getAttribute('type') || 'text').toLowerCase();
                if (['text', 'search', 'url', 'email', 'tel'].includes(type)) textElements.push(el);
                continue;
            }
            if (el.getAttribute('contenteditable') === 'true') {
                textElements.push(el);
                continue;
            }
            // A DIV qualifies only when it directly holds text and no element
            // children. Directing chat/thread/prompt wrapper DIVs flips their
            // flex/grid layout (the model bar + send button), so containers are
            // left alone — text nodes and the input carry the direction.
            if (tag === 'DIV' && (el.children.length === 0 || messageDirections?.isPlainTextTarget(el)) && el.textContent.trim().length > 0) {
                textElements.push(el);
            }
        }

        textElements.forEach(el => {
            if (el.closest('.artl-widget-container')) return;
            if (messageDirections?.owns(el)) return;
            if (el.closest('pre, code, .cm-editor, .xterm, [data-composer-code-block]')) return;
            if (el.closest('.monaco-editor') && !el.closest('.interactive-input-part, .chat-input-part, [class*="message"], [class*="request"], [data-message-id], [data-timeline-root], [data-user-message-body]')) return;

            // Form fields keep their text in .value, not .textContent.
            const isField = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
            const raw = isField ? el.value : el.textContent;
            const text = readingText(raw);
            if (!text) return;

            // Direction stays inside chat and typing content; app layout is never mirrored.
            if (!inContentScope(el)) return;

            if (!directedNodes.has(el)) {
                directedNodes.set(el, {
                    dir: el.getAttribute('dir'),
                    marked: el.classList.contains('artl-text-node'),
                    styles: ['direction', 'text-align', 'unicode-bidi'].map(name => [
                        name, el.style.getPropertyValue ? el.style.getPropertyValue(name) : '',
                        el.style.getPropertyPriority ? el.style.getPropertyPriority(name) : '',
                    ]),
                });
            }

            const dir = messageDirections?.directionFor(el) || defaultTextDirection(el, text);

            if (!el.classList.contains('artl-text-node')) {
                el.classList.add('artl-text-node');
            }

            if (el.getAttribute('dir') !== dir) {
                el.setAttribute('dir', dir);

                if (dir === 'rtl') {
                    el.style.setProperty('text-align', 'right', 'important');
                    el.style.setProperty('direction', 'rtl', 'important');
                    el.style.setProperty('unicode-bidi', 'isolate', 'important');
                } else {
                    el.style.setProperty('text-align', 'left', 'important');
                    el.style.setProperty('direction', 'ltr', 'important');
                    el.style.setProperty('unicode-bidi', 'isolate', 'important');
                }
            }
        });
    }

    // Undo everything updateDir() applied. Called when RTL is switched off so
    // previously directed text returns to the app's own layout instead of
    // keeping stale inline dir / direction styles.
    function clearDir() {
        directedNodes.forEach((original, el) => {
            if (original.dir === null) el.removeAttribute('dir');
            else el.setAttribute('dir', original.dir);
            if (!original.marked) el.classList.remove('artl-text-node');
            original.styles.forEach(([name, value, priority]) => {
                if (value) el.style.setProperty(name, value, priority);
                else el.style.removeProperty(name);
            });
        });
        directedNodes.clear();
    }

    document.addEventListener('input', updateDir, { capture: true });

    let updateDirRAF = null;
    const observer = new MutationObserver((mutations) => {
        if (!isRTL) return;
        let needsUpdate = false;
        for (let i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0 || mutations[i].removedNodes.length > 0 || mutations[i].type === 'characterData' || mutations[i].type === 'attributes') {
                needsUpdate = true;
                break;
            }
        }
        if (needsUpdate) {
            if (updateDirRAF) cancelAnimationFrame(updateDirRAF);
            updateDirRAF = requestAnimationFrame(() => {
                updateDir();
            });
        }
    });

    if (document.body) {
        observer.observe(document.body, messageObserverOptions());
    } else {
        document.addEventListener('DOMContentLoaded', observeBody, { once: true });
    }

    function observeBody() {
        if (document.body) {
            observer.observe(document.body, messageObserverOptions());
        }
    }

    function messageObserverOptions() {
        return { childList: true, subtree: true, characterData: true, attributes: true,
            attributeFilter: ['data-response-annotation-conversation', 'data-response-annotation-target',
                'data-app-shell-active-page', 'data-app-shell-focus-area', 'data-app-shell-main-surface',
                'data-message-id', 'data-message-role', 'data-turn-id', 'data-turn-key', 'data-row-id', 'data-timeline-part-id',
                'id', 'hidden', 'inert', 'aria-hidden', 'aria-modal', 'open'] };
    }

    window.navigation?.addEventListener('currententrychange', syncWidgetVisibility);
    window.addEventListener('popstate', syncWidgetVisibility);
    window.addEventListener('hashchange', syncWidgetVisibility);
    window.addEventListener('resize', syncWidgetVisibility);
    const interval = setInterval(() => {
        if (isRTL) updateDir();
    }, 1500);

    function onKeyDown(e) {
        // Radix handles Escape in the panel so nested controls dismiss first.
        if (e.target?.closest?.('.artl-widget-container')) return;
        if (e.code === 'Escape' || e.key === 'Escape') {
            if (closeConfirmation) { closeConfirmation(); e.preventDefault?.(); e.stopPropagation?.(); return; }
            if (closeMenu) { closeMenu(); e.preventDefault?.(); e.stopPropagation?.(); return; }
            closeWidget?.();
        }
        if (closeConfirmation) return;
        if (isRTL && rtlConfig.fixAtSign && e.code === 'Digit2' && e.shiftKey && inContentScope(e.target)) {
            if (e.key === '٬' || e.key === '،') {
                e.preventDefault();
                document.execCommand('insertText', false, '@');
            }
        }
    }
    document.addEventListener('keydown', onKeyDown, { capture: true });

    window.__rastaPro = {
        dispose() {
            updatesDisposed = true;
            messageContext?.dispose(); messageDirections?.dispose();
            closeWidget = null; closeMenu = null; closeConfirmation = null; clearTimeout(toastTimer); clearTimeout(toastExitTimer); disposePanel?.(); disposePanel = null; disposeTheme?.(); disposeTheme = null; disposeFonts?.(); disposeFonts = null;
            if (updatePoll) clearTimeout(updatePoll);
            if (updateCheck) clearInterval(updateCheck);
            observer.disconnect();
            widgetObserver.disconnect();
            if (updateDirRAF) cancelAnimationFrame(updateDirRAF);
            clearInterval(interval);
            document.removeEventListener('input', updateDir, { capture: true });
            document.removeEventListener('keydown', onKeyDown, { capture: true });
            document.removeEventListener('click', onOutsideClick);
            document.removeEventListener('DOMContentLoaded', observeBody);
            document.removeEventListener('DOMContentLoaded', updateDir);
            window.removeEventListener('DOMContentLoaded', createWidget);
            window.navigation?.removeEventListener('currententrychange', syncWidgetVisibility);
            window.removeEventListener('popstate', syncWidgetVisibility);
            window.removeEventListener('hashchange', syncWidgetVisibility);
            window.removeEventListener('resize', syncWidgetVisibility);
            clearDir();
            ['artl-rtl-style', 'artl-widget-style', 'artl-layout-style', 'artl-app-font-style'].forEach(id => {
                const style = document.getElementById(id);
                if (style) style.remove();
            });
            const widget = document.querySelector('.artl-widget-container');
            if (widget) widget.remove();
            window.__rastaPro = { disabled: true };
        },
    };
    if (document.body) updateDir();
    else document.addEventListener('DOMContentLoaded', updateDir, { once: true });

})();
