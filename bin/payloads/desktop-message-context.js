/** Bind the shared response control to the conversation markup of each renderer. */
export function createDesktopMessageContext({ window, changed, target, visible, isChatSurface }) {
    const selector = {
        antigravity: '[data-testid="agent-response"]',
        claude: '[data-testid="assistant-message"], [data-cds="AssistantMessage"]',
        opencode: '[data-message-id] :is([data-component="text-part"] [data-slot="text-part-body"], [data-component="markdown"]):not([data-slot="text-part-body"] *)',
        zcode: '[class~="group/assistant-row"][data-row-id] > [data-conversation-selectable]',
        grokbot: '.sand-message-prose[id]:not(p)',
    }[target];
    if (!selector) return null;
    const excluded = 'pre, code, [contenteditable="true"], [role="dialog"], [data-testid="user-message"], [data-cds="UserMessage"], [data-component="user-message"], [data-component="session-compaction-message"], [data-slot="session-turn-compaction"]';
    const valid = id => id && id.length <= 512 && !/[\u0000-\u001f\u007f]/.test(id);
    const rendered = new WeakMap();
    function current() {
        return isChatSurface() ? { conversationId: window.location.pathname + window.location.hash } : null;
    }
    window.addEventListener('popstate', changed);
    window.addEventListener('hashchange', changed);
    return {
        selector, current, verify: current, optionalStorage: true, proseSelector: ':scope',
        footerFor: target === 'zcode' ? element => element.parentElement : undefined,
        keyFor(element, { conversationId }) {
            if (element.closest(excluded) || element.parentElement?.closest(selector) || !visible(element)) return null;
            const anchor = element.querySelector('p, li, h1, h2, h3, h4, blockquote, td, th') || element;
            const text = anchor.textContent.trim();
            if (!text || anchor.closest('.artl-message-direction-control')) return null;
            const row = element.closest('[data-message-id]');
            const turn = element.closest('[data-turn-id]');
            const ids = {
                claude: /^\/chat\/[^/]+\/?$/.test(window.location.pathname)
                    ? [window.location.pathname.split('/')[2], element.closest('[data-turn-key]')?.dataset.turnKey] : [],
                opencode: [row?.dataset.messageId, element.closest('[data-timeline-part-id]')?.dataset.timelinePartId ?? element.closest('[data-component="text-part"]')?.id],
                zcode: [turn?.dataset.turnId, element.parentElement?.dataset.rowId],
                grokbot: [element.id],
            }[target] || [];
            if (ids.length && ids.every(valid)) {
                return 'rasta:message-direction:v1:' + JSON.stringify([target, ...ids]);
            }
            // For surfaces without a verified ID, confine the choice to the same
            // rendered response. A replacement or recycled node starts fresh.
            let key = rendered.get(element);
            if (!key || key.route !== conversationId || key.anchor !== anchor || !text.startsWith(key.text)) {
                key = { route: conversationId, anchor, text, value: null };
                rendered.set(element, key);
            }
            return key;
        },
        dispose() {
            window.removeEventListener('popstate', changed);
            window.removeEventListener('hashchange', changed);
        },
    };
}
