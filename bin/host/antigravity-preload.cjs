'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Only the authenticated Hub frame receives controls, and only in Rasta's world.
if (process.isMainFrame && location.protocol === 'https:' && location.hostname === '127.0.0.1') {
    const request = (action, input) => ipcRenderer.invoke('rasta:antigravity', action, input);
    const mount = async () => {
        let authorized = false;
        for (let attempt = 0; attempt < 40; attempt++) {
            try { await request('bootstrap'); authorized = true; break; }
            catch { await new Promise(resolve => setTimeout(resolve, 250)); }
        }
        if (!authorized) return;
        try {
            contextBridge.exposeInIsolatedWorld(1004, 'rastaNative', Object.freeze({
                status: () => request('status'), check: () => request('check'), preferences: () => request('preferences'),
                openManager: () => request('manager-open'), saveReading: (key, value, baseline) => request('reading-save', { key, value, baseline }),
                selectFont: id => request('font-select', { id }),
                removeFont: id => request('font-remove', { id }),
                chooseFonts: () => request('font-choose'),
                importFont: (name, data) => request('font-import', { name, data }),
            }));
            await request('mount');
            let attempts = 0;
            const ready = setInterval(() => {
                if (document.querySelector('.artl-widget-trigger[data-panel]:not([hidden])')) { clearInterval(ready); request('ready').catch(() => {}); }
                else if (++attempts >= 120) clearInterval(ready);
            }, 500);
        } catch { /* Browser guests and auxiliary views have no Rasta bridge. */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else void mount();
}
