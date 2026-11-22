/* The native bridge authorizes only this signed local page and fixed service actions. */
(() => {
    'use strict';
    const call = (action, input = {}) => window.webkit.messageHandlers.rasta.postMessage({ action, ...input });
    const trigger = document.getElementById('trigger');
    const surface = document.getElementById('panel');
    let preferences = { selected: 'vazir', fonts: [], active: null, reading: { isRTL: true, forceRTL: false, fixAtSign: false, fs: '16', lh: '1.6' } };
    let update = {};
    let nativeOpen = false;
    let intent = 0;
    const sync = () => panel.update({ preferences, update });
    const panel = RastaConnectionPanel.mount(surface, trigger, {
        name: 'Gemini',
        onReady: () => void call('mounted'),
        check: async () => { const result = await call('check'); if (!result.releaseError) { update = result; sync(); } return result; },
        openManager: () => call('manager-open'),
        changePreferences: async ({ action, input }) => {
            if (action === 'reading-save') {
                const [key, value] = Object.entries(input)[0];
                preferences = { ...preferences, reading: await call(action, { key, value }) };
            } else {
                preferences = { ...await call(action, input), reading: preferences.reading };
            }
            sync();
        },
    });
    window.rastaNativePanel = {
        updateReading: (reading) => {
            if (!nativeOpen) return;
            preferences = { ...preferences, reading: { ...preferences.reading, ...reading } };
            sync();
        },
        movePointer: (x, y) => {
            if (!nativeOpen) return;
            const shadow = surface.shadowRoot;
            const close = shadow.querySelector('[data-rasta-panel] > [data-slot=dialog-close]');
            if (close) close.toggleAttribute('data-native-hover', close.contains(shadow.elementFromPoint(x, y)));
        },
        show: async () => {
            const request = ++intent;
            try {
                const value = await call('preferences');
                if (request !== intent) return;
                preferences = { ...value, reading: value.reading || preferences.reading };
                sync();
            } catch { /* Keep the last known preferences if the service is unavailable. */ }
            finally {
                if (request === intent) {
                    nativeOpen = true;
                    if (trigger.dataset.open !== 'true') panel.toggle();
                }
            }
        },
        close: () => {
            intent++;
            nativeOpen = false;
            surface.shadowRoot.querySelector('[data-native-hover]')?.removeAttribute('data-native-hover');
            panel.close();
        },
    };
    new MutationObserver(() => {
        if (nativeOpen && trigger.dataset.open === 'false') {
            nativeOpen = false;
            void call('dismiss');
        }
    }).observe(trigger, { attributes: true, attributeFilter: ['data-open'] });
})();
