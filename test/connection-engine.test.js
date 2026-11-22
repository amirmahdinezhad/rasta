import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { cachedConnection, checkConnection, downloadConnection, managerPaths, selectConnectionRuntime } from '../bin/lib/manager.js';
import { connectionEngineId, libraryPackagePath } from '../bin/lib/connection-engine.js';
import { verifyReleaseEnvelope } from '../bin/lib/update-feed.js';
import { catalogTargets, buildLibraryZip, bundleLibraryPackages, run, save, verifyBundledLibraryPackages, verifyZip } from '../tools/development-release.js';
import { signedManifest } from '../tools/release-manifest.mjs';

const platform = `darwin-${process.arch}`;
const key = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
const bundleRuntime = app => path.join(app, 'Contents/Resources/runtime');

function engineFixture(runtime) {
    fs.mkdirSync(path.join(runtime, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(runtime, 'bin/assets'), { recursive: true });
    fs.writeFileSync(path.join(runtime, 'node'), randomBytes(64 * 1024), { mode: 0o755 });
    fs.writeFileSync(path.join(runtime, 'node-LICENSE'), 'Test license');
    fs.writeFileSync(path.join(runtime, 'node_modules/dependency.js'), 'Test dependency');
    for (const font of ['Vazir-Bold.ttf', 'Vazir-OFL.txt', 'Vazir-Regular.ttf', 'Vazir-Regular.woff2'])
        fs.writeFileSync(path.join(runtime, 'bin/assets', font), font);
}

function connectionFixture(root, source, target, version = '2.0.0') {
    const directory = path.join(root, target);
    const app = path.join(directory, catalogTargets.find(item => item.id === target).app);
    const runtime = bundleRuntime(app);
    fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
    fs.copyFileSync('/usr/bin/true', path.join(app, 'Contents/MacOS/Rasta'));
    const info = path.join(app, 'Contents/Info.plist');
    fs.writeFileSync(info, JSON.stringify({ CFBundleIdentifier: `dev.rasta.fixture.${target}`, CFBundleExecutable: 'Rasta',
        CFBundlePackageType: 'APPL', CFBundleVersion: version, CFBundleShortVersionString: version }));
    run('/usr/bin/plutil', ['-convert', 'xml1', info]);
    fs.cpSync(source, runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ version }));
    fs.writeFileSync(path.join(runtime, 'bin/release-config.json'), JSON.stringify({ target }));
    run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
    const artifact = path.join(directory, `${target}.zip`), compact = path.join(root, `${target}-library.zip`);
    run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, artifact]);
    const library = buildLibraryZip(app, compact);
    assert.ok(library.size < fs.statSync(artifact).size / 2);
    const { envelope, publicKey } = signedManifest({ artifact, library: { file: compact, engine: library.engine },
        repository: 'example/rasta', platform, version, supportedAppVersions: [], target, privateKey: key });
    const manifest = verifyReleaseEnvelope(envelope, publicKey, platform, target);
    verifyZip(compact, { ...library, target }, path.join(directory, 'reconstructed'), source);
    return { manifest, envelope, publicKey, target, library, artifact, compact };
}

test('Library reuses the signed engine for compact downloads, offline repair and manager replacement', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-connection-engine-'));
    const old = process.env.ARTL_CODEX_STATE_HOME;
    t.after(() => {
        if (old === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = old;
        fs.rmSync(root, { recursive: true, force: true });
    });
    const source = path.join(root, 'manager-runtime');
    engineFixture(source);
    const fixtures = Object.fromEntries(['codex', 't3'].map(target => [target, connectionFixture(root, source, target)]));
    const engine = connectionEngineId(source);
    const transfers = [];
    const options = {
        engineSource: source, check: async id => ({ manifest: fixtures[id].manifest, src: {} }),
        download: async (artifact, file) => {
            const filename = path.basename(new URL(artifact.url).pathname);
            const fixture = fixtures[filename.split('-')[0].replace('.zip', '')];
            transfers.push(filename);
            await delay(75);
            fs.copyFileSync(filename.includes('-library') ? fixture.compact : fixture.artifact, file);
        },
    };
    process.env.ARTL_CODEX_STATE_HOME = path.join(root, 'warm');
    await downloadConnection('codex', options);
    assert.deepEqual(transfers, ['codex-library.zip']);
    assert.equal(cachedConnection('codex').sha256, fixtures.codex.manifest.libraryArtifact.sha256);
    assert.equal(connectionEngineId(path.join(managerPaths().engines, engine)), engine);

    fs.writeFileSync(path.join(source, 'node'), 'Different engine after a manager update');
    await downloadConnection('t3', options);
    assert.deepEqual(transfers, ['codex-library.zip', 't3-library.zip']);
    const inspect = runtime => ({ supported: connectionEngineId(runtime) === engine });
    const repair = await selectConnectionRuntime('codex', { app: '/Codex.app' }, 'repair', {
        inspect, check: () => assert.fail('Offline repair must use the verified local package'),
    });
    assert.equal(repair.runtime, cachedConnection('codex').runtime);
    await selectConnectionRuntime('codex', { app: '/Codex.app' }, 'install', {
        inspect, check: options.check, download: () => assert.fail('The current compact cache is already verified'),
    });

    await assert.rejects(downloadConnection('codex', { ...options, download: async (_artifact, file) => {
        fs.copyFileSync(fixtures.t3.compact, file);
    } }), { code: 'verification-failed' });
    assert.equal(cachedConnection('codex').sha256, fixtures.codex.manifest.libraryArtifact.sha256);
    assert.equal(cachedConnection('t3').sha256, fixtures.t3.manifest.libraryArtifact.sha256);

    transfers.length = 0;
    process.env.ARTL_CODEX_STATE_HOME = path.join(root, 'cold');
    await Promise.all(['codex', 't3'].map(target => downloadConnection(target, options)));
    assert.deepEqual(transfers, ['codex.zip', 't3-library.zip']);
    assert.equal(cachedConnection('codex').sha256, fixtures.codex.manifest.artifact.sha256);
    assert.equal(cachedConnection('t3').sha256, fixtures.t3.manifest.libraryArtifact.sha256);
    const restored = cachedConnection('t3').runtime;
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.resolve(restored, '../../..')]);
});

test('Library uses only a bundled package matching the authenticated feed and falls back for a new or invalid package', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-bundled-library-'));
    const old = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = path.join(root, 'home');
    t.after(() => {
        if (old === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = old;
        fs.rmSync(root, { recursive: true, force: true });
    });

    const source = bundleRuntime(path.join(root, 'Rasta.app'));
    engineFixture(source);
    const fixtures = Object.fromEntries(catalogTargets.map(({ id }) => [id, connectionFixture(root, source, id)]));
    const publicTargets = [fixtures.codex, fixtures.t3];
    const publicSource = bundleRuntime(path.join(root, 'public/Rasta.app'));
    fs.cpSync(source, publicSource, { recursive: true });
    bundleLibraryPackages(publicSource, root, publicTargets);
    bundleLibraryPackages(source, root, Object.values(fixtures));
    assert.doesNotThrow(() => verifyBundledLibraryPackages(publicSource, publicTargets));
    assert.throws(() => verifyBundledLibraryPackages(source, publicTargets), /unexpected set/);

    let offered = fixtures.codex;
    const phases = [];
    const check = id => checkConnection(id, { config: { publicKey: offered.publicKey },
        fetcher: async () => Response.json(offered.envelope) });
    const inspect = runtime => ({ supported: connectionEngineId(runtime) === offered.library.engine });
    const install = options => selectConnectionRuntime('codex', { app: '/Codex.app' }, 'install', {
        inspect, check, download: (id, request) => downloadConnection(id, {
            engineSource: publicSource, publish: state => phases.push(state.phase), ...options, ...request,
        }),
    });
    const first = await install({ download: () => assert.fail('The bundled Codex package must not go over the network') });
    assert.equal(first.version, '2.0.0');
    assert.equal(first.sha256, fixtures.codex.library.sha256);
    assert.deepEqual(phases.splice(0), ['checking', 'verifying', 'downloaded']);
    assert.equal(cachedConnection('t3'), null);

    const next = connectionFixture(path.join(root, 'next'), source, 'codex', '2.0.1');
    offered = next;
    const download = async (artifact, file) => {
        assert.equal(artifact.sha256, next.library.sha256);
        fs.copyFileSync(next.compact, file);
    };
    const updated = await install({ download });
    assert.equal(updated.version, '2.0.1');
    assert.deepEqual(phases.splice(0), ['checking', 'downloading', 'verifying', 'downloaded']);

    const antigravity = fixtures.antigravity;
    const checkLocal = id => checkConnection(id, {
        config: { publicKey: antigravity.publicKey, localTestFeeds: { antigravity: antigravity.envelope } },
        fetcher: () => assert.fail('Local packages never reach the network'),
    });
    await downloadConnection('antigravity', { engineSource: source, check: checkLocal });
    assert.equal(cachedConnection('antigravity').sha256, antigravity.library.sha256);
    const record = path.join(managerPaths().cache, 'antigravity/record.json');
    save(record, { ...JSON.parse(fs.readFileSync(record)), channel: 'private' });
    assert.equal(cachedConnection('antigravity'), null, 'a retired channel cache cannot be selected');

    fs.copyFileSync(fixtures.t3.compact, libraryPackagePath(source, 'antigravity'));
    assert.throws(() => verifyBundledLibraryPackages(source, Object.values(fixtures)), /bundled antigravity/);
    await assert.rejects(downloadConnection('antigravity', { engineSource: source, check: checkLocal, download: () => assert.fail('Local packages never reach the network') }),
        { code: 'verification-failed' });
});
