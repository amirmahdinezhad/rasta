'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ACTIONS, runControl, chooseFonts } = require('./bridge.cjs');
const WORLD = 1004;
const CHANNEL = 'rasta:antigravity';

/** The vendor registry identifies Hub contents; loopback URLs alone never grant access. */
function eligible(contents, frame, vendor) {
    try {
        const url = new URL(frame.url);
        return frame === contents.mainFrame && !contents.hostWebContents
            && url.protocol === 'https:' && url.hostname === '127.0.0.1' && url.port !== '' && !url.username && !url.password
            && typeof vendor?.getHubWindows === 'function' && typeof vendor?.getHubWebContents === 'function'
            && vendor.getHubWindows().some(win => vendor.getHubWebContents(win) === contents);
    } catch { return false; }
}

/** Add presentation in a private world; vendor startup, preloads and browser guests stay intact. */
function install({ app, ipcMain, session, BrowserWindow, dialog }, config) {
    if (config.target !== 'antigravity' || !path.isAbsolute(config.runtime) || !path.isAbsolute(config.app)) throw Error('Invalid Antigravity configuration.');
    const payload = fs.readFileSync(path.join(__dirname, 'rasta-payload.js'), 'utf8');
    const seen = new WeakSet();
    const register = ses => {
        if (seen.has(ses)) return;
        ses.registerPreloadScript({ type: 'frame', id: 'rasta-antigravity', filePath: path.join(__dirname, 'antigravity-preload.cjs') });
        seen.add(ses);
    };
    app.on('session-created', register);
    app.whenReady().then(() => register(session.defaultSession)).catch(error => console.error('[Rasta]', error.message));
    ipcMain.handle(CHANNEL, async (event, action, input) => {
        // Consult only the already-loaded vendor module, preserving its startup order.
        const vendor = require.cache[path.join(__dirname, '../dist/utils.js')]?.exports;
        if (!eligible(event.sender, event.senderFrame, vendor)) throw Error('Untrusted Rasta request.');
        if (action === 'bootstrap') return true;
        if (action === 'mount') {
            await event.sender.executeJavaScriptInIsolatedWorld(WORLD, [{ code: payload }]);
            return true;
        }
        if (action === 'font-choose') return chooseFonts(dialog, event.sender, BrowserWindow.fromWebContents(event.sender));
        return runControl(config, action, input);
    });
}
module.exports = { install, eligible, WORLD, ACTIONS };
