import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chooseFonts, eligible } = require('../bin/host/bridge.cjs');
it('keeps T3 and Codex native origins separate and rejects embedded T3 documents', () => {
    assert.equal(eligible('t3code://app/local/thread-1', 't3'), true);
    assert.equal(eligible('t3code://app/', 't3'), true);
    for (const url of ['app://-/index.html', 'https://app/local/thread-1', 't3code://embed/local/thread-1', 't3code://app/document.html']) assert.equal(eligible(url, 't3'), false);
    assert.equal(eligible('t3code://app/local/thread-1'), false);
});
it('limits the native bridge to application shells', () => {
    assert.equal(eligible('app://-/index.html'), true);
    assert.equal(eligible('app://-/detached-window.html'), true);
    for (const url of ['https://example.com', 'app://evil/index.html', 'app://-/document.html']) assert.equal(eligible(url), false);
});
it('exposes only fixed operations in the main shell, never raw IPC or a shell executor', async () => {
    const code = fs.readFileSync(new URL('../bin/host/preload.cjs', import.meta.url), 'utf8');
    for (const [isMainFrame, pathname, exposed] of [[true, '/', true], [false, '/', false], [true, '/document.html', false]]) {
        let bridge;
        vm.runInNewContext(code, { URLSearchParams, process: { isMainFrame }, location: { protocol: 'app:', hostname: '-', pathname },
            require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'rastaNative'); bridge = value; } },
                ipcRenderer: { invoke: async (channel, action) => { assert.equal(channel, 'rasta:control'); return action; } } }) });
        assert.equal(!!bridge, exposed);
        if (bridge) {
            assert.deepEqual(Object.keys(bridge).sort(), ['check', 'chooseFonts', 'importFont', 'openManager', 'preferences', 'removeFont', 'saveReading', 'selectFont', 'status']);
            assert.equal(await bridge.openManager('ignored-command'), 'manager-open');
            assert.equal(await bridge.chooseFonts(), 'font-choose');
        }
    }
});
it('rejects iframe and unknown IPC actions before spawning a worker', async () => {
    const code = fs.readFileSync(new URL('../bin/host/bridge.cjs', import.meta.url), 'utf8');
    let handler, calls = 0, lastArgs, lastInput;
    const sandbox = { URL, WeakSet, Set, console, process: { env: {} }, __dirname: '/archive/rasta', module: { exports: {} },
        require: name => name === 'node:path' ? require(name) : { execFile: (_node, _args, _options, done) => {
            calls++; lastArgs = _args; done(null, '{"ok":true,"value":{"ready":true}}');
            return { stdin: { on() {}, end: value => { lastInput = JSON.parse(value); } } };
        } } };
    vm.runInNewContext(code, sandbox);
    sandbox.module.exports.install({ app: { on() {}, whenReady: () => Promise.resolve() },
        ipcMain: { handle: (_name, fn) => { handler = fn; } }, session: { defaultSession: { registerPreloadScript() {} } } },
    { app: '/Applications/ChatGPT.app', runtime: '/support/rtl' });
    const mainFrame = { url: 'app://-/index.html' }, sender = { mainFrame };
    await assert.rejects(handler({ sender, senderFrame: { url: mainFrame.url } }, 'prepare'), /Untrusted/);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'execute shell'), /Untrusted/);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'appearance', { theme: 'dark', accent: 'url(evil)' }), /Untrusted/);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'font-select', { id: '../bad' }), /Invalid reading font/);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'font-import', { name: 'bad.txt', data: 'abc' }), /Invalid reading font/);
    await assert.rejects(handler({ sender, senderFrame: { url: mainFrame.url } }, 'font-import', { name: 'font.ttf', data: 'abc' }), /Untrusted/);
    await assert.rejects(handler({ sender, senderFrame: { url: mainFrame.url } }, 'font-choose'), /Untrusted/);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'set-update-channel', { channel: '../beta' }), /Untrusted/);
    for (const action of ['prepare', 'repair', 'restore', 'appearance']) await assert.rejects(handler({ sender, senderFrame: mainFrame }, action, {}), /Untrusted/);
    assert.equal(calls, 0);
    assert.equal((await handler({ sender, senderFrame: mainFrame }, 'status')).ready, true);
    assert.equal(calls, 1);
    await handler({ sender, senderFrame: mainFrame }, 'manager-open', { view: 'reading' });
    assert.deepEqual(Array.from(lastArgs.slice(-2)), ['--view', 'reading']);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'reading-save', { key: 'fs', value: true }), /Invalid reading/);
    await handler({ sender, senderFrame: mainFrame }, 'reading-save', { key: 'fs', value: '18' });
    assert.deepEqual(Array.from(lastArgs.slice(-4)), ['--reading-key', 'fs', '--reading-value', '18']);
    const baseline = { isRTL: true, forceRTL: false, fixAtSign: true, fs: '18', lh: '1.8' };
    await handler({ sender, senderFrame: mainFrame }, 'reading-save', { key: 'isRTL', value: false, baseline });
    assert.deepEqual(JSON.parse(lastArgs.at(-1)), baseline);
    assert.equal(lastArgs.at(-2), '--reading-baseline');
    for (const invalid of [[], null, { command: 'bad' }, { fixAtSign: 'true' }, { fs: '999' }]) {
        await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'reading-save', { key: 'isRTL', value: false, baseline: invalid }), /Invalid reading baseline/);
    }
    await handler({ sender, senderFrame: mainFrame }, 'font-select', { id: 'vazir' });
    assert.equal(lastInput.id, 'vazir');
    await handler({ sender, senderFrame: mainFrame }, 'font-import', { name: 'Font.ttf', data: 'AAAA' });
    assert.deepEqual(lastInput, { name: 'Font.ttf', data: 'AAAA' });
    assert.equal(lastArgs.includes('AAAA'), false);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'reading-save', { key: 'isRTL', value: '--worker' }), /Invalid reading/);
    await handler({ sender, senderFrame: mainFrame }, 'manager-open', { view: 'ignored-command' });
    assert.equal(lastArgs.includes('--view'), false);
});

it('opens a native chooser for TTF and OTF and reads only eligible selections', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-font-picker-'));
    try {
        const files = ['Reading.TTF', 'Reading.otf', 'Reading.woff', 'Oversized.ttf'].map(name => path.join(directory, name));
        for (const file of files) fs.writeFileSync(file, 'font fixture');
        fs.truncateSync(files[3], 2 * 1024 * 1024 + 1);
        const contents = {}, window = {};
        const dialog = {
            async showOpenDialog(parent, options) {
                assert.equal(parent, window);
                assert.deepEqual(options.properties, ['openFile', 'multiSelections']);
                assert.deepEqual(options.filters.map(filter => filter.extensions), [['ttf', 'otf']]);
                return { canceled: false, filePaths: files };
            },
        };
        const selected = await chooseFonts(dialog, contents, window);
        assert.deepEqual(selected.map(font => font.name), files.map(file => path.basename(file)));
        for (const font of selected.slice(0, 2)) assert.equal(Buffer.from(font.data, 'base64').toString(), 'font fixture');
        for (const font of selected.slice(2)) {
            assert.match(font.error, /TTF or OTF.*2 MB/);
            assert.equal(font.data, undefined);
        }
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
        assert.deepEqual(await chooseFonts(dialog, contents, window), []);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
