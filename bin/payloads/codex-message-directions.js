/**
 * Mount direction controls on assistant responses identified by each host.
 * This function is embedded verbatim in the renderer payload: keep it closed.
 */
export function createCodexMessageDirections({ document, window, context, enabled, refresh, createRastaMark, defaultDirection }) {
    const PREFIX = 'rasta:message-direction:v1:';
    const TARGET = context?.selector || '[data-response-annotation-conversation][data-response-annotation-target]';
    const OWN = '.artl-message-direction-control';
    const MARKDOWN = ':is([data-markdown-text-style="assistant-message"], .chat-markdown, [class*="ChatMarkdown"])';
    const PROSE = (context.proseSelector || MARKDOWN) + ' :is(p, li, h1, h2, h3, h4, h5, h6, span, blockquote, td, th):not(pre *, code *, button *, .artl-message-direction-control *)';
    const records = new Map();
    const temporary = new Map();
    let storage = null, disposed = false, paletteValues = [];

    const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
        && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
        && !/^turn-index-|^\d+:(?:user|assistant)$/.test(value);
    function identity(element, view) {
        if (context.keyFor) return context.keyFor(element, view);
        if (!view.root.contains(element) || element.closest('.thread-scroll-container') !== view.root
            || element.closest('[data-app-shell-focus-area]')?.getAttribute('data-app-shell-focus-area') !== 'main') return null;
        const thread = element.getAttribute('data-response-annotation-conversation');
        const message = element.getAttribute('data-response-annotation-target');
        if (!validId(thread) || !validId(message) || thread !== view.conversationId) return null;
        if (element.closest('pre, code, [contenteditable="true"], [data-user-message-bubble]')) return null;
        if (!element.querySelector('[data-markdown-text-style="assistant-message"]')) return null;
        return PREFIX + JSON.stringify(['codex', 'local', thread, message]);
    }
    function read(key) {
        const value = typeof key === 'object' ? key.value : storage ? storage.getItem(key) : temporary.get(key);
        return value === 'rtl' || value === 'ltr' ? value : null;
    }
    function availableStorage() {
        try {
            storage = window.localStorage;
            const key = PREFIX + 'probe';
            storage.setItem(key, '1');
            if (storage.getItem(key) !== '1') return false;
            storage.removeItem(key);
            return true;
        } catch { storage = null; return false; }
    }
    function paint(record) {
        const rtl = (record.value || messageDefault(record.element)) === 'rtl';
        record.button.setAttribute('aria-pressed', String(rtl));
        record.button.title = rtl ? 'Switch to left-to-right text' : 'Switch to right-to-left text';
        record.control.classList.toggle('has-override', record.value !== null);
        record.button.setAttribute('data-direction', rtl ? 'rtl' : 'ltr');
    }
    function messageDefault(element) {
        for (const block of element.querySelectorAll(PROSE)) {
            const direction = defaultDirection(block, block.textContent);
            if (direction !== 'auto') return direction;
        }
        const markdown = element.querySelector(MARKDOWN);
        return markdown ? defaultDirection(markdown, markdown.textContent) : defaultDirection(element, element.textContent);
    }
    function readPalette() {
        const widget = document.querySelector('.artl-widget-container');
        if (!widget || !window.getComputedStyle) return [];
        const style = window.getComputedStyle(widget);
        return ['muted', 'accent', 'ink', 'soft'].map(name => ['--artl-' + name, style.getPropertyValue('--artl-' + name).trim()]);
    }
    function palette(element) {
        for (const [name, value] of paletteValues) if (value) element.style.setProperty(name, value);
    }
    function remove(record) {
        record.control.remove();
        record.element.classList.remove('artl-message-direction-target');
        records.delete(record.element);
    }
    async function toggle(record) {
        // Recheck identity at interaction time because React can reuse a message node.
        await context.verify();
        sync();
        if (records.get(record.element) !== record) return;
        const value = record.button.dataset.direction === 'rtl' ? 'ltr' : 'rtl';
        try {
            if (typeof record.key === 'object') record.key.value = value;
            else if (storage) storage.setItem(record.key, value);
            else temporary.set(record.key, value);
            if (read(record.key) !== value) throw new Error('Direction was not saved');
        } catch {
            record.status.textContent = 'Couldn’t save direction. Try again.';
            return;
        }
        record.status.textContent = '';
        refresh();
    }
    function mount(element, key) {
        const control = document.createElement('div');
        control.className = 'artl-message-direction-control';
        control.setAttribute('dir', 'ltr');
        control.setAttribute('lang', 'en');
        control.setAttribute('data-thread-find-skip', '');
        control.setAttribute('data-copy-skip', '');
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', 'Right-to-left text');
        button.appendChild(createRastaMark());
        const status = document.createElement('div');
        status.className = 'artl-message-direction-status';
        status.setAttribute('role', 'status');
        control.append(status, button);
        const record = { element, key, control, button, status, value: read(key) };
        button.onclick = event => { event.stopPropagation(); void toggle(record); };
        records.set(element, record);
        element.classList.add('artl-message-direction-target');
        (context.footerFor?.(element) || element).appendChild(control);
        palette(control);
        paint(record);
    }
    function sync() {
        if (disposed) return;
        const view = enabled() ? context.current() : null;
        if (!validId(view?.conversationId) || (!storage && !availableStorage() && !context.optionalStorage)) {
            for (const record of records.values()) remove(record);
            return;
        }
        const current = new Map();
        paletteValues = readPalette();
        // An identity must name one rendered response, never multiple variants.
        const keys = new Map();
        for (const element of document.querySelectorAll(TARGET)) {
            const key = identity(element, view);
            if (!key) continue;
            keys.set(key, (keys.get(key) || 0) + 1);
            current.set(element, key);
        }
        for (const record of records.values()) {
            if (current.get(record.element) !== record.key || keys.get(record.key) !== 1
                || !record.control.isConnected
                || record.control.parentElement !== (context.footerFor?.(record.element) || record.element)) remove(record);
        }
        try {
            for (const [element, key] of current) {
                if (keys.get(key) !== 1) continue;
                const record = records.get(element);
                if (!record) mount(element, key);
                else {
                    const footer = context.footerFor?.(element);
                    // The host can append attachments or actions when streaming finishes.
                    if (footer && footer.lastElementChild !== record.control) {
                        const focused = document.activeElement === record.button;
                        footer.appendChild(record.control);
                        if (focused) record.button.focus({ preventScroll: true });
                    }
                    if (!element.classList.contains('artl-message-direction-target')) element.classList.add('artl-message-direction-target');
                    record.value = read(key);
                    palette(record.control);
                    paint(record);
                }
            }
        } catch {
            storage = null;
            for (const record of records.values()) remove(record);
        }
    }
    function stored(event) {
        if (event.key === null || event.key?.startsWith(PREFIX)) refresh();
    }
    function themeChanged() {
        paletteValues = readPalette();
        for (const record of records.values()) palette(record.control);
    }
    window.addEventListener('storage', stored);
    const themeObserver = new window.MutationObserver(themeChanged);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', themeChanged);
    window.addEventListener('rasta-appearance-change', themeChanged);
    const style = document.createElement('style');
    style.id = 'artl-message-direction-style';
    style.textContent = `
        .artl-message-direction-control {
            --artl-muted:#6b6874; --artl-accent:#2864b4; --artl-soft:#edf3fb;
            box-sizing:border-box; display:flex; align-items:center; width:fit-content; max-width:100%; margin-left:auto;
            color:var(--artl-muted); font:12px/1.5 var(--artl-app-font,Vazir,system-ui,sans-serif);
            direction:ltr; text-align:left; user-select:none; opacity:0; pointer-events:none; transition:opacity .12s ease-out;
        }
        .artl-message-direction-target:hover > .artl-message-direction-control,
        [class~="group/assistant-row"]:hover > .artl-message-direction-control,
        .artl-message-direction-control:has(button:focus-visible) { opacity:1; pointer-events:auto; }
        .artl-message-direction-control button { display:grid; place-items:center; flex:none; width:28px; height:28px; padding:0; border:0; border-radius:6px; color:inherit; background:transparent; cursor:pointer; }
        .artl-message-direction-control svg { display:block; width:16px; height:16px; }
        .artl-message-direction-control button[data-direction=ltr] svg { transform:scaleX(-1); }
        .artl-message-direction-control.has-override button, .artl-message-direction-control button:hover { color:var(--artl-ink,var(--artl-accent)); background:var(--artl-soft); }
        .artl-message-direction-control button:focus-visible { outline:2px solid var(--artl-ink,var(--artl-accent)); outline-offset:-2px; }
        .artl-message-direction-status:not(:empty) { margin-right:8px; }
        @media (prefers-reduced-motion:reduce) { .artl-message-direction-control { transition:none; } }
    `;
    document.head.appendChild(style);
    return {
        sync,
        directionFor(element) {
            if (element.closest('button, label, legend, input, textarea, [contenteditable="true"]')) return null;
            return records.get(element.closest('.artl-message-direction-target'))?.value || null;
        },
        isPlainTextTarget(element) {
            const record = context.proseSelector && records.get(element);
            return record && element.children.length === 1 && element.firstElementChild === record.control;
        },
        owns(element) { return Boolean(element.closest(OWN)); },
        dispose() {
            disposed = true;
            for (const record of records.values()) remove(record);
            style.remove();
            window.removeEventListener('storage', stored);
            themeObserver.disconnect();
            media?.removeEventListener?.('change', themeChanged);
            window.removeEventListener('rasta-appearance-change', themeChanged);
        },
    };
}
