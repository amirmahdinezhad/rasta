import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import * as asar from '@electron/asar';
import { nativeFixture } from './helpers/native-fixture.js';
import { resolveDesktopApp } from '../bin/lib/desktop-apps.js';
import { desktopAdapter } from '../bin/lib/desktop-adapters.js';
import { targets, targetReleaseConfiguration } from '../bin/lib/targets.js';
import { hostCompatibility } from '../bin/lib/host-compatibility.js';
import { scanConnections, managerPreferences, changeConnectionPreferences } from '../bin/lib/manager.js';
import { stageNative, commitNative, restoreNative, discardNativeStage, verifyInstalledNative, inspectNative, digestSlots } from '../bin/lib/codex-native.js';
import { verifyArchiveBaseline } from '../bin/lib/vendor-baseline.js';
import { checkGUIUpdates } from '../bin/lib/gui-updates.js';
import { installedSupportPath } from '../bin/lib/app-target.js';
import { recoverySetupPath } from '../bin/lib/recovery-setup.js';
import { signedManifest } from '../tools/release-manifest.mjs';
import { verifyReleaseEnvelope } from '../bin/lib/update-feed.js';

const temporary = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-desktop-')));
const writePlist = (file, value) => { fs.writeFileSync(file, JSON.stringify(value)); execFileSync('/usr/bin/plutil', ['-convert', 'xml1', file]); };

for (const [id, version] of [['claude', '4.4212.0'], ['opencode', '1.19.5'], ['opencode', '2.2.7'], ['zcode', '3.17.2']]) test(`${id} ${version} discovers actual identity, stages without mutation, rolls back failed updates and restores its signed original`, async () => {
    const root = temporary(), oldHome = process.env.ARTL_CODEX_STATE_HOME, oldTarget = process.env.ARTL_TARGET;
    process.env.ARTL_CODEX_STATE_HOME = root; process.env.ARTL_TARGET = id;
    let stage;
    try {
        const fixture = await nativeFixture(path.join(root, 'host'), version, true, id);
        const bundle = resolveDesktopApp(id, fixture.app), original = fs.readFileSync(bundle.archive);
        const pkg = JSON.parse(asar.extractFile(bundle.archive, 'package.json'));
        assert.equal(bundle.target, id); assert.equal(bundle.version, version); assert.equal(bundle.build, version);
        assert.equal(hostCompatibility(bundle).compatible, true);
        assert.equal(hostCompatibility(bundle, { blockedVersions: [version] }).compatible, false);
        assert.equal(inspectNative(bundle).state, 'not-patched');
        assert.deepEqual(scanConnections({ resolve: target => target === id ? bundle : null }).map(app => app.id), [id]);
        const runtime = path.join(root, 'Library/Application Support', targets[id].support, 'ui-runtimes/fixture');
        const host = { target: id, app: bundle.app, runtime, agentVersion: '1.0.5', desktopAdapter: bundle.desktopAdapter };
        let requests = 0;
        const checked = await checkGUIUpdates({ app: bundle.app, flow: 'download-launch', setupInstall: true }, { fetcher: async () => { requests++; throw Error('Unexpected network access'); } });
        assert.equal(checked.supported, true); assert.equal(checked.releaseConfigured, true); assert.equal(requests, 0);
        await checkGUIUpdates({ app: bundle.app, flow: 'download-launch' }, { fetcher: async url => {
            assert.equal(String(url), `https://github.com/amirmahdinezhad/rasta/releases/latest/download/${targets[id].feed}`);
            requests++;
            return new Response(null, { status: 404 });
        } });
        assert.equal(requests, 1);
        stage = stageNative(bundle, { allowLocalSigning: true, payload: '// presentation', host });
        assert.deepEqual(fs.readFileSync(bundle.archive), original);
        assert.equal(stage.report.originalDataHash, stage.report.preservedDataHash);
        const archive = path.join(stage.stagedApp, 'Contents/Resources/app.asar');
        const nextPkg = JSON.parse(asar.extractFile(archive, 'package.json'));
        assert.equal(nextPkg.type, pkg.type);
        assert.equal(nextPkg.main, id === 'claude' ? 'rasta/main.cjs' : 'rasta/main.mjs');
        const originalMain = path.posix.normalize(pkg.main);
        assert.deepEqual(asar.statFile(archive, originalMain), asar.statFile(bundle.archive, originalMain));
        for (const file of asar.listPackage(bundle.archive).filter(file => /\.(?:js|cjs|html)$/.test(file))) assert.deepEqual(asar.extractFile(archive, file.slice(1)), asar.extractFile(bundle.archive, file.slice(1)), file);
        if (id !== 'claude') assert.match(asar.extractFile(archive, 'rasta/main.mjs').toString(), /import '\.\/desktop-bootstrap\.cjs';\nimport "\.\.\/out\/main\/index\.js";/);
        const binary = fs.readFileSync(path.join(stage.stagedApp, 'Contents/Frameworks/Electron Framework.framework/Versions/Current/Electron Framework'));
        assert.equal(digestSlots(binary, { allowDisabled: bundle.allowDisabledIntegrity }).length, id === 'claude' ? 1 : 0);
        commitNative(stage); discardNativeStage(stage); stage = null;
        assert.equal(verifyInstalledNative(bundle).signatureVerified, true);
        assert.equal(hostCompatibility(resolveDesktopApp(id, bundle.app)).compatible, true);
        assert.equal(installedSupportPath({ home: root, app: bundle.app, target: id }), path.dirname(path.dirname(runtime)));
        assert.equal(recoverySetupPath(root), path.join(root, 'Applications', targets[id].setup));
        const installed = fs.readFileSync(bundle.archive);
        stage = stageNative(bundle, { allowLocalSigning: true, payload: '// next presentation', host: { ...host, agentVersion: '1.0.6' } });
        assert.equal(stage.report.refreshing, true);
        assert.throws(() => commitNative(stage, { verifyInstalled: () => { throw Error('Fixture failed startup'); } }), /Fixture failed startup/);
        assert.deepEqual(fs.readFileSync(bundle.archive), installed);
        discardNativeStage(stage); stage = null;
        restoreNative(bundle); assert.deepEqual(fs.readFileSync(bundle.archive), original);
        execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle.app]);
        const info = path.join(bundle.app, 'Contents/Info.plist');
        const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', info]));
        writePlist(info, { ...plist, CFBundleIdentifier: 'unrelated.app' });
        assert.throws(() => resolveDesktopApp(id, bundle.app), /identity/);
        assert.equal(resolveDesktopApp(id, null, { roots: [path.dirname(bundle.app)] }), null);
        writePlist(info, { ...plist, CFBundleShortVersionString: '999.0.0' });
        assert.throws(() => resolveDesktopApp(id, bundle.app), /identity\/version/);
        const config = targetReleaseConfiguration({ feedUrl: 'codex-feed', supportedAppVersions: ['codex'], blockedAppVersions: ['codex'] }, id);
        assert.equal(config.feedUrl, null); assert.deepEqual(config.supportedAppVersions, []); assert.deepEqual(config.blockedAppVersions, []);
        changeConnectionPreferences(id, 'reading-save', { fs: '18' }, { scan: () => [] });
        for (const other of Object.keys(targets).filter(other => other !== id && other !== 'gemini')) assert.equal(managerPreferences(other, { scan: () => [] }).reading.fs, '16');
    } finally {
        if (stage) discardNativeStage(stage);
        if (oldHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = oldHome;
        if (oldTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = oldTarget;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Claude registry discovery rejects ambiguous registries and launchers with a different entry', async () => {
    const root = temporary();
    try {
        const fixture = await nativeFixture(root, '4.4212.0', false, 'claude');
        assert.throws(() => desktopAdapter(fixture.archive, 'claude', { main: 'other.js' }), /startup/);
        assert.throws(() => desktopAdapter(fixture.archive, 'opencode', { main: 'out/main/index.js' }), /startup/);
        const source = path.join(root, 'source');
        fs.writeFileSync(path.join(source, '.vite/build/launcher.js'), "require('./other.js');");
        const changedLauncher = path.join(root, 'changed-launcher.asar');
        await asar.createPackage(source, changedLauncher);
        assert.throws(() => desktopAdapter(changedLauncher, 'claude', { main: '.vite/build/launcher.js' }), /launcher/);
        fs.copyFileSync(path.join(source, '.vite/build/index.chunk-fixture.js'), path.join(source, '.vite/build/index.chunk-second.js'));
        const ambiguous = path.join(root, 'ambiguous.asar'); await asar.createPackage(source, ambiguous);
        assert.throws(() => desktopAdapter(ambiguous, 'claude', { main: '.vite/build/index.pre.js' }), /registry/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Library detects an installed Claude with an unsupported entry and reports compatibility separately', async () => {
    const root = temporary();
    try {
        const { app, archive } = await nativeFixture(root, '6.30000.0', false, 'claude');
        const source = path.join(root, 'source');
        const packageFile = path.join(source, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(packageFile));
        pkg.main = '.vite/build/main.js';
        fs.writeFileSync(packageFile, JSON.stringify(pkg));
        await asar.createPackage(source, archive);
        const resolve = (id, options) => resolveDesktopApp(id, null, { ...options, roots: [root] });
        assert.throws(() => resolveDesktopApp('claude', app), /startup adapter/);
        const [detected] = scanConnections({ id: 'claude', resolve });
        assert.equal(detected.app, app);
        assert.equal(detected.hostVersion, pkg.version);
        assert.equal(detected.installed, false);
        assert.equal(detected.compatibility.compatible, false);
        assert.equal(detected.compatibility.code, 'rasta-update-required');
        assert.deepEqual(scanConnections({ id: 'opencode', resolve }), []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ZCode can reconcile stale metadata on an unknown build using a sealed archive and the pinned publisher', () => {
    const app = '/fixture/ZCode.app';
    const bundle = { app, target: 'zcode', version: '9.0.0', build: '9.0.0.1234', archive: path.join(app, 'Contents/Resources/app.asar') };
    const metadataHash = 'a'.repeat(64), header = 'b'.repeat(64);
    const metadata = { 'Resources/app.asar': { algorithm: 'SHA256', hash: metadataHash } };
    const seal = Buffer.alloc(32, 127).toString('base64');
    const calls = [];
    const options = { run: (file, args) => { calls.push({ file, args }); return seal; } };
    assert.equal(verifyArchiveBaseline(bundle, metadata, header, [], options).vendorMetadataReconciled, true);
    assert.deepEqual(calls[0], { file: '/usr/bin/plutil', args: ['-extract', 'files2.Resources/app\\.asar.hash2', 'raw', '-expect', 'data', '-o', '-', path.join(app, 'Contents/_CodeSignature/CodeResources')] });
    const { file, args } = calls[1];
    assert.equal(file, '/usr/bin/codesign');
    assert.deepEqual(args.slice(0, 4), ['--verify', '--deep', '--strict', '-R']);
    assert.match(args[4], /dev\.zcode\.app.*anchor apple generic.*8A5X4JJ39T/);
    assert.equal(args[5], app);
    for (const target of ['codex', 'claude', 't3'])
        assert.throws(() => verifyArchiveBaseline({ ...bundle, target }, metadata, header, [], options), /integrity/);
    assert.throws(() => verifyArchiveBaseline({ ...bundle, archive: '/other/app.asar' }, metadata, header, [], options), /archive location/);
    assert.throws(() => verifyArchiveBaseline(bundle, metadata, header, [123], options), /integrity/);
    assert.throws(() => verifyArchiveBaseline(bundle, { 'Resources/app.asar': { algorithm: 'SHA256', hash: '' } }, header, [], options), /metadata/);
    assert.equal(verifyArchiveBaseline(bundle, metadata, metadataHash, [], options).vendorMetadataReconciled, false);
    assert.equal(calls.length, 2);
    assert.throws(() => verifyArchiveBaseline(bundle, metadata, header, [], { run: () => '' }), /SHA-256 resource seal/);
    assert.throws(() => verifyArchiveBaseline(bundle, metadata, header, [], {
        run: file => { if (file.endsWith('/plutil')) return seal; throw Error('Bad signature'); },
    }), /Bad signature/);
});

test('new desktop signed releases cannot cross connection boundaries', () => {
    const root = temporary();
    try {
        const artifact = path.join(root, 'fixture.zip'); fs.writeFileSync(artifact, 'fixture');
        const { privateKey } = generateKeyPairSync('ed25519');
        for (const target of ['claude', 'opencode', 'zcode']) {
            const { envelope, publicKey } = signedManifest({ target, artifact, version: '1.0.5', platform: 'darwin-arm64', repository: 'example/rasta', supportedAppVersions: [], privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) });
            assert.equal(verifyReleaseEnvelope(envelope, publicKey, 'darwin-arm64', target).target, target);
            for (const other of Object.keys(targets).filter(id => id !== target)) assert.throws(() => verifyReleaseEnvelope(envelope, publicKey, 'darwin-arm64', other), /another application/);
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
