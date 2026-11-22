'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
const { constants, open } = require('node:fs/promises');
const CHANNEL = 'rasta:control';
const ACTIONS = new Set(['status', 'check', 'ready', 'preferences', 'reading-save', 'font-select', 'font-remove', 'font-import', 'manager-open']);
const READING_VALUES = { fs: ['14', '16', '18'], lh: ['1.4', '1.6', '1.8'] };
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const MAX_FONT_DATA_LENGTH = Math.ceil(MAX_FONT_BYTES / 3) * 4;
const fontPickers = new WeakSet();
function eligible(url, target = 'codex') {
    try { const value = new URL(url); if (target === 't3') return value.protocol === 't3code:' && value.hostname === 'app' && (['/', '/index.html'].includes(value.pathname) || /^\/[^/.]+\/[^/.]+\/?$/.test(value.pathname)); return value.protocol === 'app:' && value.hostname === '-'
        && ['/', '/index.html', '/detached-window.html', '/detached-window'].includes(value.pathname)
        && !/character|avatar|dictation|spotlight|screen-overlay|browser-comment|snap-guides/.test(value.searchParams.get('initialRoute') || ''); }
    catch { return false; }
}
function install({ app, ipcMain, session, BrowserWindow, dialog }, config) {
    if (!path.isAbsolute(config.runtime) || !path.isAbsolute(config.app)) throw new Error('Invalid native configuration.');
    const seen = new WeakSet();
    const register = ses => {
        if (seen.has(ses)) return;
        if (typeof ses.registerPreloadScript !== 'function') throw new Error('This Electron version does not support the addon preload.');
        ses.registerPreloadScript({ type: 'frame', id: 'rasta-controls', filePath: path.join(__dirname, 'preload.cjs') });
        seen.add(ses);
    };
    app.on('session-created', register);
    app.whenReady().then(() => register(session.defaultSession)).catch(error => console.error('[Rasta]', error.message));
    ipcMain.handle(CHANNEL, async (event, action, input) => {
        const frame = event.senderFrame;
        if (!frame || frame !== event.sender.mainFrame || !eligible(frame.url, config.target)) throw new Error('Untrusted Rasta request.');
        if (action === 'font-choose') return chooseFonts(dialog, event.sender, BrowserWindow.fromWebContents(event.sender));
        return runControl(config, action, input);
    });
}
async function readChosenFont(filePath) {
    const name = path.basename(filePath);
    const invalid = { name, error: 'Choose a valid TTF or OTF font up to 2 MB.' };
    if (!/\.(ttf|otf)$/i.test(name)) return invalid;
    try {
        const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
        try {
            const info = await file.stat();
            if (!info.isFile() || info.size === 0 || info.size > MAX_FONT_BYTES) return invalid;
            const buffer = Buffer.alloc(info.size + 1);
            let length = 0;
            while (length < buffer.length) {
                const { bytesRead } = await file.read(buffer, length, buffer.length - length);
                if (!bytesRead) break;
                length += bytesRead;
            }
            if (length !== info.size) return invalid;
            return { name, data: buffer.subarray(0, length).toString('base64') };
        } finally {
            await file.close();
        }
    } catch {
        return { name, error: 'Rasta could not read this font file.' };
    }
}

async function chooseFonts(dialog, contents, window) {
    if (fontPickers.has(contents)) return [];
    fontPickers.add(contents);
    try {
        const options = {
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Fonts (TTF, OTF)', extensions: ['ttf', 'otf'] }],
        };
        const selection = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
        if (selection.canceled) return [];
        const fonts = [];
        for (const filePath of selection.filePaths) fonts.push(await readChosenFont(filePath));
        return fonts;
    } finally {
        fontPickers.delete(contents);
    }
}
// Share the same validated actions after each adapter authenticates its renderer.
async function runControl(config, action, input) {
    if (!ACTIONS.has(action)) throw new Error('Untrusted Rasta request.');
    const extra = [];
    if (action === 'reading-save') {
        const valid = ['isRTL', 'forceRTL', 'fixAtSign'].includes(input?.key) ? typeof input.value === 'boolean'
            : Object.hasOwn(READING_VALUES, input?.key) && READING_VALUES[input.key].includes(input.value);
        if (!valid)
            throw new Error('Invalid reading setting.');
        extra.push('--reading-key', input.key, '--reading-value', String(input.value));
        if (input.baseline !== undefined) {
            if (!input.baseline || typeof input.baseline !== 'object' || Array.isArray(input.baseline)
                || Object.entries(input.baseline).some(([key, value]) =>
                    ['isRTL', 'forceRTL', 'fixAtSign'].includes(key) ? typeof value !== 'boolean'
                        : !Object.hasOwn(READING_VALUES, key) || !READING_VALUES[key].includes(value)))
                throw new Error('Invalid reading baseline.');
            extra.push('--reading-baseline', JSON.stringify(input.baseline));
        }
    }
    let fontRequest;
    if (action === 'font-select' || action === 'font-remove') {
        if (typeof input?.id !== 'string' || !/^(vazir|[a-f0-9]{32})$/.test(input.id)) throw new Error('Invalid reading font.');
        fontRequest = { id: input.id };
    }
    if (action === 'font-import') {
        if (typeof input?.name !== 'string' || input.name.length > 1024 || !/\.(ttf|otf)$/i.test(input.name)
            || typeof input.data !== 'string' || !input.data.length || input.data.length > MAX_FONT_DATA_LENGTH
            || input.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw new Error('Invalid reading font.');
        fontRequest = { name: input.name, data: input.data };
    }
    if (action === 'manager-open' && input?.view === 'reading') extra.push('--view', 'reading');
    return await new Promise((resolve, reject) => {
        const environment = { ...process.env, ARTL_TARGET: config.target || 'codex' };
        for (const key of Object.keys(environment)) if (key.startsWith('CODEX_') || key === 'ELECTRON_RUN_AS_NODE') delete environment[key];
        const child = execFile(path.join(config.runtime, 'node'), [path.join(config.runtime, 'bin/gui-service.js'), '--rpc', action, '--app', config.app, ...extra],
            { env: environment, timeout: action === 'check' ? 45000 : 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
                try { const response = JSON.parse(stdout); if (!response.ok) reject(new Error(response.error)); else resolve(response.value); }
                catch (parseError) { reject(error || parseError); }
            });
        if (fontRequest) {
            child.stdin.on('error', reject);
            child.stdin.end(JSON.stringify(fontRequest));
        }
    });
}
module.exports = { install, eligible, ACTIONS, runControl, chooseFonts };
