import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { eligible } = require('../bin/host/desktop-bridge.cjs');

for (const [target, kind, url] of [['claude', 'claude-view', 'app://localhost/chat/fixture'], ['opencode', 'opencode-renderer', 'oc://renderer/index.html'], ['zcode', 'zcode-file', 'file:///Applications/ZCode.app/Contents/Resources/app.asar/out/renderer/index.html'], ['grokbot', 'grokbot-file', 'file:///Applications/Grok%20Bot.app/Contents/Resources/app.asar/dist/renderer/index.html']]) test(`${target} authorizes only its own top-level surface and fixed reading controls`, async () => {
    const mainFrame = { url }, contents = { mainFrame }, owner = { webContents: contents, isDestroyed: () => false };
    const config = { target, app: target === 'grokbot' ? '/Applications/Grok Bot.app' : '/Applications/ZCode.app', runtime: '/fixture/runtime', desktopAdapter: { kind, registryModule: '.vite/build/index.chunk-fixture.js', registryExport: 'registry' } };
    const registry = { mainView: { webContents: contents } }, BrowserWindow = { fromWebContents: candidate => candidate === contents ? owner : null };
    assert.equal(eligible(contents, mainFrame, config, { registry, BrowserWindow }), true);
    assert.equal(eligible(contents, { ...mainFrame }, config, { registry, BrowserWindow }), false);
    contents.hostWebContents = {}; assert.equal(eligible(contents, mainFrame, config, { registry, BrowserWindow }), false); delete contents.hostWebContents;
    for (const value of ['https://example.com', 'https://claude.ai/login', 'https://claude.ai.evil/chat/fixture', 'https://claude.ai:42/chat/fixture', 'https://user@claude.ai/chat/fixture', 'file:///tmp/index.html', 'oc://foreign/index.html', 'oc://renderer/resource-manager.html', 'app://localhost:42/chat/fixture', 'app://evil/']) {
        mainFrame.url = value; assert.equal(eligible(contents, mainFrame, config, { registry, BrowserWindow }), false, value);
    }
    mainFrame.url = 'https://claude.ai/chat/fixture';
    assert.equal(eligible(contents, mainFrame, config, { registry, BrowserWindow }), target === 'claude');
    mainFrame.url = url;
    assert.equal(eligible(contents, mainFrame, config, { registry: { mainView: { webContents: {} } }, BrowserWindow: { fromWebContents: () => null } }), false);
    let handler, mounted, invoked = 0;
    contents.executeJavaScriptInIsolatedWorld = async (world, scripts) => { mounted = { world, scripts }; };
    const requireFixture = name => name === './bridge.cjs' ? control.module.exports : name === 'node:path' || name === 'node:url' ? require(name)
        : name === 'node:fs' ? { readFileSync: () => 'window.fixture = true;' }
            : { execFile: (_file, _args, options, done) => { assert.equal(options.env.ARTL_TARGET, target); invoked++; done(null, '{"ok":true,"value":{"ready":true}}'); } };
    requireFixture.cache = { '/fixture/.vite/build/index.chunk-fixture.js': { exports: { registry } } };
    const sandbox = { URL, Set, WeakSet, console, process: { env: {} }, __dirname: '/fixture/rasta', module: { exports: {} }, require: requireFixture };
    const control = { ...sandbox, module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(new URL('../bin/host/bridge.cjs', import.meta.url), 'utf8'), control);
    vm.runInNewContext(fs.readFileSync(new URL('../bin/host/desktop-bridge.cjs', import.meta.url), 'utf8'), sandbox);
    sandbox.module.exports.install({ app: { on() {}, whenReady: () => Promise.resolve() }, session: { defaultSession: { registerPreloadScript() {} } }, BrowserWindow, ipcMain: { handle: (_name, fn) => { handler = fn; } } }, config);
    const event = { sender: contents, senderFrame: mainFrame };
    assert.equal(await handler(event, 'bootstrap'), true);
    await handler(event, 'mount'); assert.equal(mounted.world, 1005); assert.equal(mounted.scripts[0].code, 'window.fixture = true;');
    for (const action of ['install', 'repair', 'restore', 'set-update-channel', 'execute']) await assert.rejects(handler(event, action), /Untrusted/);
    assert.equal(invoked, 0); assert.equal((await handler(event, 'status')).ready, true); assert.equal(invoked, 1);
    await assert.rejects(handler(event, 'reading-save', { key: 'font', value: true }), /Invalid reading/);
    await assert.rejects(handler(event, 'reading-save', { key: 'forceRTL', value: 'true' }), /Invalid reading/);
    assert.equal((await handler(event, 'reading-save', { key: 'forceRTL', value: true })).ready, true);
    await assert.rejects(handler({ ...event, senderFrame: { ...mainFrame } }, 'mount'), /Untrusted/);
});
