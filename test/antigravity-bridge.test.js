import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { eligible } = require('../bin/host/antigravity-bridge.cjs');
const vendorFor = contents => ({ getHubWindows: () => [contents], getHubWebContents: win => win });
const config = { target: 'antigravity', app: '/Applications/Antigravity.app', runtime: '/fixture/runtime' };
const hub = () => {
    const mainFrame = { url: 'https://127.0.0.1:54321/' };
    return { mainFrame, getLastWebPreferences: () => ({ preload: '/Applications/Antigravity.app/Contents/Resources/app.asar/dist/preload.js' }) };
};

test('Antigravity authenticates its vendor Hub registry and main frame rather than any loopback page', () => {
    const contents = hub();
    assert.equal(eligible(contents, contents.mainFrame, vendorFor(contents)), true);
    assert.equal(eligible(contents, { ...contents.mainFrame }, vendorFor(contents)), false);
    for (const url of ['http://127.0.0.1:54321/', 'https://localhost:54321/', 'https://127.0.0.1/', 'https://user@127.0.0.1:54321/', 'https://example.com/', 'file:///app.html', 'app://-/']) {
        contents.mainFrame.url = url; assert.equal(eligible(contents, contents.mainFrame, vendorFor(contents)), false, url);
    }
    contents.mainFrame.url = 'https://127.0.0.1:54321/';
    contents.hostWebContents = {}; assert.equal(eligible(contents, contents.mainFrame, vendorFor(contents)), false);
    delete contents.hostWebContents;
    assert.equal(eligible(contents, contents.mainFrame, vendorFor({})), false);
    assert.equal(eligible(contents, contents.mainFrame, undefined), false);
});

test('Antigravity mounts only its packaged presentation in a private world and shares validated preference RPC', async () => {
    let handler, spawned = [], mounted, stdin;
    const code = fs.readFileSync(new URL('../bin/host/antigravity-bridge.cjs', import.meta.url), 'utf8');
    const sandbox = { URL, Set, WeakSet, console, process: { env: {} }, __dirname: '/archive/rasta', module: { exports: {} },
        require: name => name === './bridge.cjs' ? control.module.exports : name === 'node:path' ? require(name) : name === 'node:fs' ? { readFileSync: () => 'window.fixturePayload = true;' }
            : { execFile: (_file, args, options, done) => {
                assert.equal(options.env.ARTL_TARGET, 'antigravity');
                spawned.push(Array.from(args).slice(1));
                done(null, '{"ok":true,"value":{"ready":true}}');
                return { stdin: { on() {}, end: data => { stdin = JSON.parse(data); } } };
            } } };
    const control = { ...sandbox, module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(new URL('../bin/host/bridge.cjs', import.meta.url), 'utf8'), control);
    vm.runInNewContext(code, sandbox);
    sandbox.module.exports.install({ app: { on() {}, whenReady: () => Promise.resolve() }, session: { defaultSession: { registerPreloadScript() {} } }, ipcMain: { handle: (_name, value) => { handler = value; } } }, config);
    const contents = hub(); contents.executeJavaScriptInIsolatedWorld = async (world, scripts) => { mounted = { world, scripts }; };
    sandbox.require.cache = { '/archive/dist/utils.js': { exports: vendorFor(contents) } };
    const event = { sender: contents, senderFrame: contents.mainFrame };
    assert.equal(await handler(event, 'bootstrap'), true);
    await handler(event, 'mount'); assert.equal(mounted.world, 1004); assert.equal(mounted.scripts[0].code, 'window.fixturePayload = true;');
    for (const action of ['install', 'restore', 'set-update-channel', 'execute']) await assert.rejects(handler(event, action), /Untrusted/);
    await assert.rejects(handler(event, 'font-select', { id: '../font.ttf' }), /Invalid reading font/);
    await assert.rejects(handler(event, 'font-import', { name: 'font.ttf', data: '!bad' }), /Invalid reading font/);
    await assert.rejects(handler(event, 'reading-save', { key: 'fs', value: '999' }), /Invalid reading setting/);
    await assert.rejects(handler({ ...event, senderFrame: {} }, 'font-select', { id: 'vazir' }), /Untrusted/);
    assert.equal(spawned.length, 0);
    assert.equal((await handler(event, 'status')).ready, true);
    await handler(event, 'reading-save', { key: 'fs', value: '16' });
    assert.deepEqual(spawned.at(-1).slice(-4), ['--reading-key', 'fs', '--reading-value', '16']);
    await handler(event, 'font-import', { name: 'font.ttf', data: 'YQ==' });
    assert.deepEqual(stdin, { name: 'font.ttf', data: 'YQ==' });
    await assert.rejects(handler({ ...event, senderFrame: { ...contents.mainFrame } }, 'mount'), /Untrusted/);
});
