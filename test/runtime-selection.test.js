import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nativeFixture } from './helpers/native-fixture.js';
import { inspectConnectionRuntime, selectConnectionRuntime } from '../bin/lib/manager.js';

test('T3 recovery replaces an obsolete cached engine using only the selected target', async () => {
    let cached = { runtime: '/cache/t3/old', version: '1.1.16', channel: 'stable' };
    const calls = [];
    const selected = await selectConnectionRuntime('t3', { app: '/T3.app', name: 'T3 Code', hostVersion: '0.1.8' }, 'install', {
        cached: id => { assert.equal(id, 't3'); return cached; },
        inspect: runtime => { assert.ok(runtime.endsWith('new'), 'an obsolete cache does not need a compatibility probe'); return { supported: true }; },
        check: async id => { calls.push(['check', id]); return { manifest: { agentVersion: '1.1.39' }, src: {} }; },
        download: async (id, options) => { calls.push(['download', id]); assert.equal((await options.check()).manifest.agentVersion, '1.1.39'); cached = { runtime: '/cache/t3/new', version: '1.1.39', channel: 'stable' }; },
    });
    assert.equal(selected.runtime, '/cache/t3/new');
    assert.deepEqual(calls, [['check', 't3'], ['download', 't3']]);
});

test('repair selects a newer compatible cache before an installed engine and works offline', async () => {
    const selected = await selectConnectionRuntime('t3', { app: '/T3.app', runtime: '/installed/old', version: '1.1.16' }, 'repair', {
        cached: () => ({ runtime: '/cache/new', version: '1.1.39', channel: 'stable' }),
        inspect: runtime => ({ supported: runtime.endsWith('new') }),
        check: async () => { throw Error('A compatible local repair must not contact a feed'); },
    });
    assert.equal(selected.runtime, '/cache/new');
});

test('an unsuccessful feed check never reports that a compatible release does not exist', async () => {
    await assert.rejects(selectConnectionRuntime('t3', { app: '/T3.app' }, 'install', {
        cached: () => null, check: async () => { throw Error('offline'); },
    }), { code: 'release-check-failed' });
});

test('a failed local probe does not claim that the publisher needs to release support', async () => {
    await assert.rejects(selectConnectionRuntime('t3', { app: '/T3.app' }, 'install', {
        cached: () => ({ runtime: '/cache', version: '1.1.39', channel: 'stable' }),
        inspect: () => ({ supported: false, code: 'compatibility-check-failed' }),
        check: async () => ({ manifest: { agentVersion: '1.1.39' }, src: {} }),
    }), { code: 'compatibility-check-failed' });
});

test('an incompatible new engine retains the usable old cache and identifies the checked release', async () => {
    const cached = { runtime: '/cache/old', version: '1.1.39', channel: 'stable' };
    let rejected;
    await assert.rejects(selectConnectionRuntime('t3', { app: '/T3.app', name: 'T3 Code' }, 'install', {
        cached: () => cached,
        inspect: runtime => ({ supported: runtime === cached.runtime }),
        check: async () => ({ manifest: { agentVersion: '1.1.40' }, src: {} }),
        download: async (_id, { validate }) => {
            try { await validate({ runtime: '/staged/new', version: '1.1.40' }); }
            catch (error) { rejected = error; throw error; }
            assert.fail('an incompatible candidate cannot replace the cache');
        },
    }), { code: 'rasta-update-required' });
    assert.equal(cached.runtime, '/cache/old');
    assert.equal(rejected.checkedVersion, '1.1.40');
    assert.equal(rejected.code, 'rasta-update-required');

});

test('a checked but incompatible release stays blocked and a retired cache cannot satisfy public installation', async () => {
    let cached = { runtime: '/retired', version: '2.0.0', channel: 'retired' }, downloads = 0;
    await assert.rejects(selectConnectionRuntime('t3', { app: '/T3.app', name: 'T3 Code', hostVersion: '0.2.0' }, 'install', {
        cached: () => cached,
        inspect: () => ({ supported: false }),
        check: async () => ({ manifest: { agentVersion: '2.0.0' }, src: {} }),
        download: async () => { downloads++; cached = { runtime: '/stable', version: '2.0.0', channel: 'stable' }; },
    }), { code: 'rasta-update-required' });
    assert.equal(downloads, 1);
});

test('each engine is probed with its own policy without touching the app or persisted GUI choice', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-runtime-probe-'));
    try {
        const fixture = await nativeFixture(path.join(root, 'host'), '0.1.9', true, 't3');
        const original = fs.readFileSync(fixture.archive);
        const make = (name, policy) => {
            const runtime = path.join(root, name);
            fs.mkdirSync(path.join(runtime, 'bin/lib'), { recursive: true });
            fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ type: 'module', version: name === 'old' ? '1.1.16' : '1.1.39' }));
            fs.writeFileSync(path.join(runtime, 'bin/release-config.json'), JSON.stringify({ target: 't3' }));
            fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
            const actual = pathToFileURL(fileURLToPath(new URL('../bin/lib/gui-updates.js', import.meta.url))).href;
            fs.writeFileSync(path.join(runtime, 'bin/lib/gui-updates.js'), policy || `export { resolveGUIApp, updatePlan, releaseConfiguration } from ${JSON.stringify(actual)};`);
            return runtime;
        };
        const old = make('old', `export const releaseConfiguration=()=>({target:'t3'}); export const resolveGUIApp=()=>({version:'0.1.9'}); export const updatePlan=(_config, version)=>({supported:version==='0.1.6'});`);
        const current = make('new');
        // Current engines actually run the structural/integrity inspection.
        const checker = pathToFileURL(fileURLToPath(new URL('../bin/lib/host-compatibility.js', import.meta.url))).href;
        fs.writeFileSync(path.join(current, 'bin/lib/host-compatibility.js'), `export { hostCompatibility } from ${JSON.stringify(checker)};`);
        assert.equal(inspectConnectionRuntime(old, 't3', fixture.app).supported, false);
        const result = inspectConnectionRuntime(current, 't3', fixture.app);
        assert.equal(result.supported, true);
        assert.equal(result.compatibility.tested, false);
        assert.equal(inspectConnectionRuntime(current, 'codex', fixture.app).supported, false);
        assert.deepEqual(fs.readFileSync(fixture.archive), original);
        assert.equal(fs.existsSync(path.join(root, 'Library')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a manager-selected engine cannot delegate to a stale saved engine even with a higher version', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-selected-engine-'));
    try {
        const fixture = await nativeFixture(path.join(root, 'host'), '0.1.8', true, 't3');
        const resources = path.join(fixture.app, 'Contents/Resources/cua_node/bin');
        fs.mkdirSync(resources, { recursive: true }); fs.symlinkSync(process.execPath, path.join(resources, 'node'));
        fs.writeFileSync(path.join(resources, '../LICENSE'), 'Fixture runtime license\n');
        const support = path.join(root, 'Library/Application Support/Rasta T3');
        fs.mkdirSync(support, { recursive: true });
        fs.writeFileSync(path.join(support, 'gui-config.json'), JSON.stringify({ app: fixture.app, runtime: '/obsolete/engine', agentVersion: '99.0.0', initialInstall: false }));
        const original = fs.readFileSync(fixture.archive);
        // This check snapshots an engine but never executes its native helper.
        // Own the distribution fixture so clean CI needs no prebuilt local UI.
        const distribution = path.join(root, 'distribution');
        fs.mkdirSync(distribution);
        const repository = fileURLToPath(new URL('../', import.meta.url));
        fs.cpSync(path.join(repository, 'bin'), path.join(distribution, 'bin'), { recursive: true });
        for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(repository, file), path.join(distribution, file));
        fs.symlinkSync(path.join(repository, 'node_modules'), path.join(distribution, 'node_modules'));
        fs.writeFileSync(path.join(distribution, 'bin/assets/rasta-ui'), 'Fixture helper; not executed by the policy check.\n');
        const service = path.join(distribution, 'bin/gui-service.js');
        const response = JSON.parse(execFileSync(process.execPath, [service, '--rpc', 'check', '--app', fixture.app, '--setup', '--manager-ui', '--manager-selected-runtime'], {
            env: { ...process.env, ARTL_TARGET: 't3', ARTL_CODEX_STATE_HOME: root }, encoding: 'utf8',
        }));
        assert.equal(response.ok, true);
        assert.equal(response.value.supported, true);
        const saved = JSON.parse(fs.readFileSync(path.join(support, 'gui-config.json')));
        assert.notEqual(saved.runtime, '/obsolete/engine');
        assert.ok(saved.runtime.startsWith(path.join(support, 'ui-runtimes')));
        assert.deepEqual(fs.readFileSync(fixture.archive), original, 'selection does not install or replace the host');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('main install never falls back to a compatible old package after a failed latest check', async () => {
    await assert.rejects(selectConnectionRuntime('codex', { app: '/Codex.app' }, 'install', {
        cached: () => ({ runtime: '/old', version: '1.1.16', channel: 'stable' }),
        inspect: () => ({ supported: true }), check: async () => { throw Error('offline'); },
    }), { code: 'release-check-failed' });
});
