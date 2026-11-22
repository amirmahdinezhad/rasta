import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import * as asar from '@electron/asar';
import { nativeFixture } from './helpers/native-fixture.js';
import { resolveGUIApp, checkGUIUpdates, runGUIJob } from '../bin/lib/gui-updates.js';
import { hostCompatibility } from '../bin/lib/host-compatibility.js';
import { createHash } from 'node:crypto';

for (const target of ['codex', 't3']) test(`${target} supports structurally compatible older and newer hosts locally`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-compatible-host-'));
    const oldHome = process.env.ARTL_CODEX_STATE_HOME, oldTarget = process.env.ARTL_TARGET;
    process.env.ARTL_CODEX_STATE_HOME = home; process.env.ARTL_TARGET = target;
    try {
        for (const version of target === 't3' ? ['0.1.3', '0.1.99'] : ['26.1.1', '99.1.1']) {
            const fixture = await nativeFixture(path.join(home, version), version, true, target);
            const bundle = resolveGUIApp(fixture.app);
            assert.equal(hostCompatibility(bundle).compatible, true);
            let requests = 0;
            const result = await checkGUIUpdates({ app: bundle.app, flow: 'download-launch', setupInstall: true }, {
                osVersion: '15.0', fetcher: async () => { requests++; throw Error('offline'); },
            });
            assert.equal(requests, 0); assert.equal(result.supported, true); assert.equal(result.targetVersion, version);
            assert.equal(result.requiresAppUpdate, false); assert.equal(result.compatibility.status, 'unverified');
        }
    } finally {
        if (oldHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = oldHome;
        if (oldTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = oldTarget;
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test('an incompatible selected package checks locally while a release check verifies the signed feed', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-engine-feed-'));
    const oldHome = process.env.ARTL_CODEX_STATE_HOME, oldTarget = process.env.ARTL_TARGET;
    process.env.ARTL_CODEX_STATE_HOME = home; process.env.ARTL_TARGET = 't3';
    try {
        const fixture = await nativeFixture(path.join(home, 'host'), '0.1.99', true, 't3');
        const sourcePackage = path.join(home, 'host/source/package.json');
        fs.writeFileSync(sourcePackage, JSON.stringify({ ...JSON.parse(fs.readFileSync(sourcePackage)), type: 'module' }));
        await asar.createPackage(path.join(home, 'host/source'), fixture.archive);
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const manifest = { schema: 1, target: 't3', agentVersion: '2.0.0', supportedAppVersions: ['0.1.99'], downloads: {
            'darwin-arm64': { url: 'https://github.com/example/repo/releases/download/v2.0.0/setup.zip', size: 1, sha256: 'a'.repeat(64) } } };
        const body = Buffer.from(JSON.stringify(manifest));
        const envelope = { payload: body.toString('base64'), signature: sign(null, body, privateKey).toString('base64') };
        const config = { app: fixture.app, agentVersion: '1.0.0', flow: 'download-launch', setupInstall: true, initialInstall: true };
        const catalog = { target: 't3', supportedAppVersions: ['0.1.6'], publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'), feedUrl: 'https://github.com/example/repo/releases/latest/download/feed.json' };
        const requests = [];
        const options = { arch: 'arm64', osVersion: '15.0', releaseConfig: catalog, fetcher: async url => { requests.push(String(url)); return new Response(JSON.stringify(envelope)); } };
        const local = await checkGUIUpdates(config, options);
        assert.equal(requests.length, 0); assert.equal(local.supported, false);
        const recovery = await checkGUIUpdates({ ...config, setupInstall: false, initialInstall: false }, options);
        assert.equal(requests.length, 1); assert.equal(requests[0], catalog.feedUrl);
        assert.equal(recovery.release.agentVersion, '2.0.0');
        assert.equal(recovery.compatibility.compatible, false, 'an available engine is not proof of host compatibility');
        const offline = await checkGUIUpdates({ ...config, setupInstall: false, initialInstall: false }, { ...options, fetcher: async () => { throw Error('offline'); } });
        assert.equal(offline.release, null); assert.match(offline.releaseError, /offline/);
        const bad = await checkGUIUpdates({ ...config, setupInstall: false, initialInstall: false }, { ...options, fetcher: async () => new Response(JSON.stringify({ ...envelope, signature: Buffer.alloc(64).toString('base64') })) });
        assert.equal(bad.release, null); assert.match(bad.releaseError, /signature/);
    } finally {
        if (oldHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = oldHome;
        if (oldTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = oldTarget;
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test('a downloaded engine repeats local checks and cannot replace an incompatible host', async () => {
    const { execFileSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { downloadArtifact } = await import('../bin/lib/update-feed.js');
    const { guiPaths, readJSON } = await import('../bin/lib/gui-runtime.js');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-engine-recheck-'));
    const oldHome = process.env.ARTL_CODEX_STATE_HOME, oldTarget = process.env.ARTL_TARGET;
    process.env.ARTL_CODEX_STATE_HOME = home; process.env.ARTL_TARGET = 't3';
    try {
        const fixture = await nativeFixture(path.join(home, 'host'), '0.1.99', true, 't3');
        const sourcePackage = path.join(home, 'host/source/package.json');
        fs.writeFileSync(sourcePackage, JSON.stringify({ ...JSON.parse(fs.readFileSync(sourcePackage)), type: 'module' }));
        await asar.createPackage(path.join(home, 'host/source'), fixture.archive);
        const before = fs.readFileSync(fixture.archive);
        const releaseApp = path.join(home, 'release/Rasta T3 Setup.app');
        const runtime = path.join(releaseApp, 'Contents/Resources/runtime'); fs.mkdirSync(runtime, { recursive: true });
        const repository = fileURLToPath(new URL('../', import.meta.url));
        fs.cpSync(path.join(repository, 'bin'), path.join(runtime, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ type: 'module', version: '2.0.0' }));
        fs.writeFileSync(path.join(runtime, 'bin/release-config.json'), JSON.stringify({ target: 't3', feedUrl: null, supportedAppVersions: ['0.1.99'] }));
        fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
        fs.symlinkSync(path.join(repository, 'node_modules'), path.join(runtime, 'node_modules'));
        const zip = path.join(home, 'engine.zip'); execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', releaseApp, zip]);
        const data = fs.readFileSync(zip);
        const artifact = { url: 'https://github.com/example/repo/releases/download/v2.0.0/engine.zip', size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
        const folder = path.join(guiPaths().jobs, 'engine'); fs.mkdirSync(folder, { recursive: true });
        let requests = 0, stages = 0;
        const result = await runGUIJob({ schema: 1, id: 'engine', folder, action: 'repair', config: {
            app: fixture.app, runtime: home, agentVersion: '1.0.0', flow: 'download-install', setupInstall: true,
        } }, {
            check: async () => ({ supported: true, release: { agentVersion: '2.0.0', artifact } }),
            download: (value, file, options) => downloadArtifact(value, file, { ...options, fetcher: async () => { requests++; return new Response(data); } }),
            stage: () => { stages++; throw Error('old engine must not stage'); },
            quit: () => { throw Error('must not quit'); },
        });
        assert.equal(requests, 1); assert.equal(stages, 0); assert.equal(result, 'failed');
        assert.match(readJSON(guiPaths().status).error, /startup adapter/);
        assert.deepEqual(fs.readFileSync(fixture.archive), before, 'the failed new-engine check leaves the host unchanged');
        const handoff = readJSON(path.join(folder, 'job.json'));
        assert.equal(handoff.config.setupInstall, true);
    } finally {
        if (oldHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = oldHome;
        if (oldTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = oldTarget;
        fs.rmSync(home, { recursive: true, force: true });
    }
});
