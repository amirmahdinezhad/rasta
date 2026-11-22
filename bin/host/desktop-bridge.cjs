'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { ACTIONS, runControl, chooseFonts } = require('./bridge.cjs');
const WORLD = 1005, CHANNEL = 'rasta:desktop';
const TARGETS = new Set(['claude', 'opencode', 'zcode', 'grokbot']);

/** Match an owned top-level app surface; embedded sites and auxiliary windows never qualify. */
function eligible(contents, frame, config, { BrowserWindow, registry } = {}) {
    try {
        if (!TARGETS.has(config.target) || !frame || frame !== contents.mainFrame || contents.hostWebContents) return false;
        const url = new URL(frame.url);
        if (url.username || url.password || url.port) return false;
        const adapter = config.desktopAdapter;
        if (config.target === 'claude') {
            const claudeOrigin = (url.protocol === 'app:' && url.hostname === 'localhost') || url.origin === 'https://claude.ai';
            return adapter?.kind === 'claude-view' && registry?.mainView?.webContents === contents && claudeOrigin
                && !/^\/(?:login|logout|signup|auth|oauth)(?:\/|$)/.test(url.pathname);
        }
        const owner = BrowserWindow?.fromWebContents(contents);
        if (!owner || owner.webContents !== contents || owner.isDestroyed()) return false;
        if (config.target === 'opencode') return adapter?.kind === 'opencode-renderer' && url.protocol === 'oc:' && url.hostname === 'renderer' && url.pathname === '/index.html';
        if (config.target === 'grokbot') return adapter?.kind === 'grokbot-file' && url.protocol === 'file:' && !url.hostname
            && fileURLToPath(url) === path.join(config.app, 'Contents/Resources/app.asar/dist/renderer/index.html');
        // ZCode loads the same index.html for its conversations and its update window.
        return adapter?.kind === 'zcode-file' && url.protocol === 'file:' && !url.hostname
            && url.searchParams.get('windowKind') !== 'update-status'
            && fileURLToPath(url) === path.join(config.app, 'Contents/Resources/app.asar/out/renderer/index.html');
    } catch { return false; }
}

/** Register a private presentation world without rewriting vendor preloads, UI or networking. */
function install({ app, ipcMain, session, BrowserWindow, dialog }, config) {
    if (!TARGETS.has(config.target) || !path.isAbsolute(config.runtime) || !path.isAbsolute(config.app)) throw Error('Invalid desktop connection configuration.');
    const payload = fs.readFileSync(path.join(__dirname, 'rasta-payload.js'), 'utf8');
    const seen = new WeakSet();
    const register = ses => {
        if (seen.has(ses)) return;
        ses.registerPreloadScript({ type: 'frame', id: 'rasta-desktop', filePath: path.join(__dirname, 'desktop-preload.cjs') }); seen.add(ses);
    };
    app.on('session-created', register);
    app.whenReady().then(() => register(session.defaultSession)).catch(error => console.error('[Rasta]', error.message));
    ipcMain.handle(CHANNEL, async (event, action, input) => {
        let registry;
        if (config.target === 'claude') {
            const adapter = config.desktopAdapter;
            if (!/^\.vite\/build\/index\.chunk-[\w-]+\.js$/.test(adapter?.registryModule || '') || !/^[\w$]+$/.test(adapter?.registryExport || '')) throw Error('Invalid Claude registry.');
            // Only inspect a module the vendor has already loaded; do not alter startup order.
            registry = require.cache[path.join(__dirname, '..', adapter.registryModule)]?.exports?.[adapter.registryExport];
        }
        if (!eligible(event.sender, event.senderFrame, config, { BrowserWindow, registry })) throw Error('Untrusted Rasta request.');
        if (action === 'bootstrap') return true;
        if (action === 'mount') { await event.sender.executeJavaScriptInIsolatedWorld(WORLD, [{ code: payload }]); return true; }
        if (action === 'font-choose') return chooseFonts(dialog, event.sender, BrowserWindow.fromWebContents(event.sender));
        return runControl(config, action, input);
    });
}
module.exports = { install, eligible, WORLD, ACTIONS };
