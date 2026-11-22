import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import * as asar from '@electron/asar';
import { nativeFixture } from './helpers/native-fixture.js';
import { codexCompatibility } from '../bin/lib/codex-compatibility.js';
import { checkGUIUpdates, prepareGUIStage, runGUIJob, resolveGUIApp } from '../bin/lib/gui-updates.js';
import { discardNativeStage, stageNative, commitNative, restoreNative, nativePaths } from '../bin/lib/codex-native.js';
import { removeRecoverySetup } from '../bin/lib/recovery-setup.js';
import { guiPaths, saveJSON, readJSON } from '../bin/lib/gui-runtime.js';

it('checks unknown hosts locally and rejects missing startup, HTML, preload and integrity requirements', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-capabilities-'));
    try {
        const bundle = await nativeFixture(dir, '99.1.1');
        const bytes = fs.readFileSync(bundle.archive);
        assert.equal(codexCompatibility(bundle).status, 'unverified');
        assert.equal(codexCompatibility(bundle, { testedVersions: [bundle.version] }).status, 'tested');
        assert.equal(codexCompatibility(bundle, { blockedVersions: [bundle.version] }).compatible, false);
        const source = path.join(dir, 'source'), pkg = path.join(source, 'package.json');
        const originalPackage = fs.readFileSync(pkg);
        fs.writeFileSync(pkg, JSON.stringify({ ...JSON.parse(originalPackage), type: 'module' }));
        await asar.createPackage(source, bundle.archive);
        assert.match(codexCompatibility(bundle).message, /startup adapter/);
        fs.writeFileSync(pkg, originalPackage); fs.rmSync(path.join(source, 'webview/detached-window.html'));
        await asar.createPackage(source, bundle.archive);
        assert.equal(codexCompatibility(bundle).compatible, false);
        fs.writeFileSync(bundle.archive, bytes);
        const framework = path.join(bundle.app, 'Contents/Frameworks/Codex Framework.framework/Versions/Current/Codex Framework');
        const binary = fs.readFileSync(framework), changed = Buffer.from(binary);
        Buffer.from('unsupportedPreloadXX').copy(changed, changed.indexOf(Buffer.from('registerPreloadScript')));
        fs.writeFileSync(framework, changed);
        assert.match(codexCompatibility(bundle).message, /preload API/);
        fs.writeFileSync(framework, binary);
        execFileSync('/usr/bin/plutil', ['-replace', 'ElectronAsarIntegrity', '-json', JSON.stringify({ 'Resources/app.asar': { algorithm: 'SHA256', hash: '0'.repeat(64) } }), path.join(bundle.app, 'Contents/Info.plist')]);
        assert.match(codexCompatibility(bundle).message, /integrity/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('keeps unknown-host repair available with both feeds offline, then stages without modifying the host', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-offline-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    let stage;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const bundle = await nativeFixture(path.join(dir, 'fixture'), '99.1.1');
        const original = fs.readFileSync(bundle.archive);
        const config = { app: bundle.app, runtime: dir, flow: 'download-launch', agentVersion: '9.9.9' };
        const result = await checkGUIUpdates(config, { fetcher: async () => { throw new Error('offline'); }, osVersion: '15.0' });
        assert.equal(result.supported, true); assert.equal(result.requiresAppUpdate, false);
        assert.equal(result.compatibility.status, 'unverified'); assert.match(result.releaseError, /offline/);
        const initial = await checkGUIUpdates({ ...config, initialInstall: true, setupInstall: true }, {
            fetcher: async () => assert.fail('Initial installation uses the embedded runtime'), osVersion: '15.0',
        });
        assert.equal(initial.available, false);
        stage = prepareGUIStage({ config });
        assert.equal(stage.report.originalDataHash, stage.report.preservedDataHash);
        assert.deepEqual(fs.readFileSync(bundle.archive), original);
        execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', stage.stagedApp], { stdio: 'pipe' });
    } finally {
        if (stage) discardNativeStage(stage);
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('removes an owned legacy recovery app and preserves unrelated apps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-recovery-app-'));
    try {
        const destination = path.join(dir, 'Applications/Rasta Setup.app');
        const marker = path.join(destination, 'Contents/Resources/rasta-recovery');
        fs.mkdirSync(path.dirname(marker), { recursive: true });
        fs.writeFileSync(marker, 'dev.rasta.codex.recovery');
        removeRecoverySetup(destination);
        assert.equal(fs.existsSync(destination), false);
        fs.mkdirSync(destination);
        fs.writeFileSync(path.join(destination, 'unrelated'), 'keep');
        removeRecoverySetup(destination);
        assert.equal(fs.readFileSync(path.join(destination, 'unrelated'), 'utf8'), 'keep');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('retains authenticated incompatibility policy offline and rejects tampered network metadata', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-policy-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const bundle = await nativeFixture(path.join(dir, 'fixture'), '99.1.1');
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const catalog = { publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
            feedUrl: 'https://github.com/example/repo/releases/latest/download/feed.json', supportedAppVersions: [] };
        const manifest = { schema: 1, agentVersion: '2.0.0', supportedAppVersions: [], blockedAppVersions: [bundle.version],
            downloads: { 'darwin-arm64': { url: 'https://github.com/example/repo/releases/download/v2.0.0/setup.zip', size: 1, sha256: '0'.repeat(64) } } };
        const payload = Buffer.from(JSON.stringify(manifest));
        const envelope = { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
        saveJSON(path.join(guiPaths().support, 'compatibility-policy.json'), envelope);
        const config = { app: bundle.app, flow: 'download-launch', agentVersion: '9.0.0' };
        const options = { releaseConfig: catalog, arch: 'arm64', osVersion: '15.0', fetcher: async () => { throw new Error('offline'); } };
        assert.equal((await checkGUIUpdates(config, options)).supported, false, 'cached signed block remains effective offline');
        assert.match((await checkGUIUpdates(config, options)).compatibility.message, /known to be incompatible/);
        const changed = { ...envelope, payload: Buffer.from(JSON.stringify({ ...manifest, blockedAppVersions: [] })).toString('base64') };
        const result = await checkGUIUpdates(config, { ...options, fetcher: async () => new Response(JSON.stringify(changed)) });
        assert.equal(result.supported, false); assert.match(result.releaseError, /signature/);
    } finally {
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('repairs a replaced host offline only after Launch approval and restores the new host rather than its old backup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-host-replacement-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    let initial;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const old = await nativeFixture(path.join(dir, 'installed'), '26.1027.61615');
        initial = stageNative(old, { allowLocalSigning: true, host: { app: old.app, runtime: dir, agentVersion: '1.0.0' } });
        commitNative(initial); discardNativeStage(initial); initial = null;
        const vendor = await nativeFixture(path.join(dir, 'vendor-update'), '99.1.1');
        const pristine = fs.readFileSync(vendor.archive);
        fs.rmSync(old.app, { recursive: true }); fs.cpSync(vendor.app, old.app, { recursive: true, verbatimSymlinks: true });
        const bundle = resolveGUIApp(old.app), paths = guiPaths();
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.0.0' }));
        fs.copyFileSync('/usr/bin/true', path.join(dir, 'rasta-ui'));
        saveJSON(path.join(paths.support, 'font-preferences.json'), { sentinel: 'retained' });
        const folder = path.join(paths.jobs, 'repair'); fs.mkdirSync(folder, { recursive: true });
        const config = { app: bundle.app, runtime: dir, flow: 'download-install', agentVersion: '2.0.0' };
        const result = await runGUIJob({ schema: 1, id: 'repair', folder, action: 'repair', config }, {
            running: () => false, installEvent: () => {},
            check: next => checkGUIUpdates(next, { fetcher: async () => { throw new Error('offline'); }, osVersion: '15.0' }),
            publish: state => {
                if (state.phase === 'ready-to-install') {
                    assert.deepEqual(fs.readFileSync(bundle.archive), pristine, 'preparation leaves the new vendor app unchanged');
                    saveJSON(path.join(folder, 'install-request.json'), { id: 'repair' });
                }
            },
        });
        assert.equal(result, 'complete');
        assert.equal(readJSON(path.join(paths.support, 'font-preferences.json')).sentinel, 'retained');
        assert.equal(readJSON(paths.config).initialInstall, false);
        const backup = readJSON(nativePaths().state).backup;
        assert.deepEqual(fs.readFileSync(path.join(backup, 'Contents/Resources/app.asar')), pristine);
        assert.equal(restoreNative(bundle), true);
        assert.deepEqual(fs.readFileSync(bundle.archive), pristine);
    } finally {
        if (initial) discardNativeStage(initial);
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

for (const target of ['codex', 't3']) {
    it(`${target} ignores obsolete standalone feeds and offers signed Library updates`, async t => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-library-feed-'));
        const home = process.env.ARTL_CODEX_STATE_HOME, previousTarget = process.env.ARTL_TARGET;
        process.env.ARTL_CODEX_STATE_HOME = dir;
        process.env.ARTL_TARGET = target;
        t.after(() => {
            if (home === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
            else process.env.ARTL_CODEX_STATE_HOME = home;
            if (previousTarget === undefined) delete process.env.ARTL_TARGET;
            else process.env.ARTL_TARGET = previousTarget;
            fs.rmSync(dir, { recursive: true, force: true });
        });
        const bundle = await nativeFixture(path.join(dir, 'fixture'), target === 'codex' ? '26.1117.31558' : '0.1.11', true, target);
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const catalog = { publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
            feedUrl: 'https://github.com/example/rasta/releases/latest/download/feed.json',
            supportedAppVersions: [], libraryUpdatesOnly: true };
        const artifact = {
            url: 'https://github.com/example/rasta/releases/download/v1.0.1/connection.zip',
            size: 10, sha256: 'a'.repeat(64),
        };
        const envelope = (version, extra) => {
            const payload = Buffer.from(JSON.stringify({ schema: 1, target, agentVersion: version, supportedAppVersions: [],
                downloads: { 'darwin-arm64': artifact }, ...extra }));
            return { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
        };
        const old = envelope('1.1.16', { blockedAppVersions: [bundle.version] });
        const current = envelope('1.0.1', { libraryDownloads: { 'darwin-arm64': { ...artifact,
            url: 'https://github.com/example/rasta/releases/download/v1.0.1/library.zip', size: 4, engine: 'b'.repeat(64) } } });
        const policyFile = path.join(guiPaths().support, 'compatibility-policy.json');
        saveJSON(policyFile, old);
        const check = feed => checkGUIUpdates({ app: bundle.app, flow: 'download-launch', agentVersion: '1.0.0' }, {
            releaseConfig: catalog, arch: 'arm64', osVersion: '15.0', fetcher: async () => Response.json(feed),
        });
        const outdated = await check(old);
        assert.equal(outdated.available, false);
        assert.equal(outdated.release, null);
        assert.equal(outdated.compatibility.compatible, true);
        assert.equal(readJSON(guiPaths().cache).available, false);
        const updated = await check(current);
        assert.equal(updated.available, true);
        assert.equal(updated.release.agentVersion, '1.0.1');
        assert.deepEqual(readJSON(policyFile), current);
        const invalid = await check({ ...current, signature: old.signature });
        assert.equal(invalid.available, false);
        assert.match(invalid.releaseError, /signature/);
    });
}
