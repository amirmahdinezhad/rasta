import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { nativeFixture } from './helpers/native-fixture.js';
import { resolveGoogleApp } from '../bin/lib/google-apps.js';
import { removeGUIData, finishGUIUninstall } from '../bin/lib/gui-uninstall.js';
import { guiPaths } from '../bin/lib/gui-runtime.js';
import { targets, targetReleaseConfiguration } from '../bin/lib/targets.js';
import { savedConnectionStates, scanConnections, manageConnection, downloadConnection, managerPreferences, changeConnectionPreferences } from '../bin/lib/manager.js';
import { checkGUIUpdates } from '../bin/lib/gui-updates.js';
import { hostCompatibility } from '../bin/lib/host-compatibility.js';
import { stageNative, commitNative, restoreNative, discardNativeStage, inspectNative, verifyInstalledNative, digestSlots } from '../bin/lib/codex-native.js';

const temporary = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-google-')));
const plist = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); execFileSync('/usr/bin/plutil', ['-convert', 'xml1', file]); };

test('discovers actual Google identities and rejects a malformed native Gemini executable', async () => {
    const root = temporary();
    try {
        const fixture = await nativeFixture(root, '2.29.1', true, 'antigravity');
        const antigravity = resolveGoogleApp('antigravity', fixture.app);
        assert.equal(antigravity.version, '2.29.1'); assert.equal(antigravity.build, '2.29.1');
        const geminiApp = path.join(root, 'Gemini.app'); fs.mkdirSync(path.join(geminiApp, 'Contents/MacOS'), { recursive: true });
        fs.writeFileSync(path.join(geminiApp, 'Contents/MacOS/Gemini'), 'native fixture');
        const info = path.join(geminiApp, 'Contents/Info.plist');
        const identity = { CFBundleIdentifier: 'com.google.GeminiMacOS', CFBundleExecutable: 'Gemini', CFBundleShortVersionString: '1.138.0.1315', CFBundleVersion: '1315' };
        plist(info, identity);
        const gemini = resolveGoogleApp('gemini', geminiApp);
        assert.equal(gemini.native, true); assert.equal(gemini.build, '1315'); assert.equal(gemini.archive, undefined);
        const apps = scanConnections({ resolve: id => ({ antigravity, gemini })[id] });
        assert.deepEqual(apps.map(app => app.id), ['antigravity', 'gemini']);
        assert.equal(apps[0].compatibility.compatible, true);
        assert.notEqual(apps[1].available, false); assert.equal(apps[1].installed, false);
        assert.equal(apps[1].compatibility.status, 'incompatible');
        plist(info, { ...identity, CFBundleIdentifier: 'com.macpaw.Gemini' });
        assert.throws(() => resolveGoogleApp('gemini', geminiApp), /identity/);
        assert.equal(resolveGoogleApp('gemini', null, { roots: [root] }), null);
        plist(info, { ...identity, CFBundleExecutable: '../Gemini' });
        assert.throws(() => resolveGoogleApp('gemini', geminiApp), /executable/);
        plist(info, { ...identity, CFBundleVersion: '' });
        assert.throws(() => resolveGoogleApp('gemini', geminiApp), /version\/build/);
        assert.throws(() => resolveGoogleApp('codex'), /Unknown/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Antigravity stages, verifies and restores its own signed backup with vendor logic and disabled digest preserved', async () => {
    const root = temporary(), previousHome = process.env.ARTL_CODEX_STATE_HOME, previousTarget = process.env.ARTL_TARGET;
    process.env.ARTL_CODEX_STATE_HOME = root; process.env.ARTL_TARGET = 'antigravity';
    let stage;
    try {
        const fixture = await nativeFixture(path.join(root, 'host'), '2.29.1', true, 'antigravity');
        const bundle = resolveGoogleApp('antigravity', fixture.app), original = fs.readFileSync(bundle.archive);
        assert.equal(hostCompatibility(bundle).compatible, true);
        assert.equal(hostCompatibility(bundle, { blockedVersions: [bundle.version] }).compatible, false);
        assert.equal(inspectNative(bundle).state, 'not-patched');
        let requests = 0;
        const checked = await checkGUIUpdates({ app: bundle.app, flow: 'download-launch', setupInstall: true }, { fetcher: async () => { requests++; throw Error('Network must not be used'); } });
        assert.equal(checked.supported, true); assert.equal(checked.releaseConfigured, true); assert.equal(requests, 0);
        await checkGUIUpdates({ app: bundle.app, flow: 'download-launch' }, { fetcher: async url => {
            assert.equal(String(url), `https://github.com/amirmahdinezhad/rasta/releases/latest/download/${targets['antigravity'].feed}`);
            requests++;
            return new Response(null, { status: 404 });
        } });
        assert.equal(requests, 1);
        stage = stageNative(bundle, { allowLocalSigning: true, payload: 'window.__rastaFixture = true;', host: { target: 'antigravity', app: bundle.app, runtime: '/fixture/runtime', agentVersion: '1.0.5' } });
        assert.deepEqual(fs.readFileSync(bundle.archive), original, 'preparation leaves the installed app untouched');
        assert.equal(stage.report.originalDataHash, stage.report.preservedDataHash);
        const archive = path.join(stage.stagedApp, 'Contents/Resources/app.asar');
        assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).main, 'rasta/main.cjs');
        for (const name of ['dist/main.js', 'dist/preload.js', 'dist/utils.js', 'dist/constants.js']) assert.deepEqual(asar.extractFile(archive, name), asar.extractFile(bundle.archive, name));
        assert.equal(asar.extractFile(archive, 'rasta/rasta-payload.js').toString(), 'window.__rastaFixture = true;');
        const framework = path.join(stage.stagedApp, 'Contents/Frameworks/Electron Framework.framework/Versions/Current/Electron Framework');
        assert.deepEqual(digestSlots(fs.readFileSync(framework), { allowDisabled: true }), []);
        assert.throws(() => digestSlots(fs.readFileSync(framework)), /disabled/);
        commitNative(stage); stage = null;
        assert.equal(verifyInstalledNative(bundle).signatureVerified, true);
        assert.equal(hostCompatibility(bundle).compatible, true);
        const installed = fs.readFileSync(bundle.archive);
        stage = stageNative(bundle, { allowLocalSigning: true, payload: '// refresh', host: { target: 'antigravity', app: bundle.app, runtime: '/fixture/runtime', agentVersion: '1.0.6' } });
        assert.equal(stage.report.refreshing, true);
        assert.throws(() => commitNative(stage, { verifyInstalled: () => { throw Error('Fixture verification failed'); } }), /Fixture verification failed/);
        assert.deepEqual(fs.readFileSync(bundle.archive), installed, 'a failed target update restores the working installation');
        discardNativeStage(stage); stage = null; verifyInstalledNative(bundle);
        restoreNative(bundle);
        assert.deepEqual(fs.readFileSync(bundle.archive), original);
        assert.equal(inspectNative(bundle).state, 'not-patched');
        execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle.app]);
        assert.equal(fs.existsSync(path.join(root, 'Library/Application Support/Rasta')), false);
        assert.equal(fs.existsSync(path.join(root, 'Library/Application Support/Rasta T3')), false);
    } finally {
        if (stage) discardNativeStage(stage);
        if (previousHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = previousHome;
        if (previousTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = previousTarget;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Google preferences, workers and release configuration never fall back to Codex or T3', () => {
    const root = temporary(), previous = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = root;
    try {
        const scan = () => [];
        changeConnectionPreferences('antigravity', 'reading-save', { fs: '18' }, { scan });
        assert.equal(managerPreferences('antigravity', { scan }).reading.fs, '18');
        assert.equal(managerPreferences('codex', { scan }).reading.fs, '16');
        assert.equal(managerPreferences('t3', { scan }).reading.fs, '16');
        const config = { feedUrl: 'codex-feed', supportedAppVersions: ['26.1'], t3FeedUrl: 't3-feed', supportedT3Versions: ['0.1.7'], blockedAppVersions: ['26.0'] };
        const antigravity = targetReleaseConfiguration(config, 'antigravity');
        assert.equal(antigravity.feedUrl, null); assert.deepEqual(antigravity.supportedAppVersions, []); assert.deepEqual(antigravity.blockedAppVersions, []);
        assert.equal(targetReleaseConfiguration(config, 't3').feedUrl, 't3-feed');
        assert.equal(targetReleaseConfiguration(config, 'gemini').feedUrl, null);
        assert.deepEqual(targetReleaseConfiguration(config, 'gemini').supportedAppVersions, []);
        assert.throws(() => targetReleaseConfiguration(config, '../codex'), /Unknown/);
        for (const id of ['codex', 't3', 'antigravity', 'gemini']) {
            const probe = `import {supportPath,targetId} from './bin/lib/app-target.js'; console.log(JSON.stringify({id:targetId(),support:supportPath()}));`;
            const value = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, ARTL_TARGET: id }, encoding: 'utf8' }));
            assert.equal(value.id, id); assert.equal(value.support, path.join(root, 'Library/Application Support', targets[id].support));
        }
        assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', "import {targetId} from './bin/lib/app-target.js';targetId();"], { env: { ...process.env, ARTL_TARGET: 'unknown' }, stdio: 'pipe' }));
    } finally { if (previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); }
});

for (const selected of ['codex', 't3', 'antigravity', 'claude', 'opencode', 'zcode']) test(`${selected} removal preserves every other connection and its stale jobs`, async () => {
    const root = temporary(), oldHome = process.env.ARTL_CODEX_STATE_HOME, oldTarget = process.env.ARTL_TARGET;
    process.env.ARTL_CODEX_STATE_HOME = root;
    try {
        const agents = path.join(root, 'Library/LaunchAgents'); fs.mkdirSync(agents, { recursive: true });
        const states = Object.keys(targets).map((id, index) => {
            process.env.ARTL_TARGET = id;
            const paths = guiPaths(), label = 'dev.rasta.update.' + String(index + 1).repeat(12);
            fs.mkdirSync(paths.support, { recursive: true }); fs.writeFileSync(paths.config, 'keep other target');
            const program = path.join(paths.support, 'missing-runtime/node');
            fs.writeFileSync(path.join(agents, label + '.plist'), program);
            return { id, paths, label, program };
        });
        const jobs = new Map(states.map(state => [state.label, state.program]));
        const removed = [];
        const run = (_file, args) => {
            if (args[0] === 'list') return [...jobs.keys()].map(label => '- 0 ' + label).join('\n');
            const label = args[1].split('/').at(-1);
            if (args[0] === 'bootout') { removed.push(label); jobs.delete(label); return ''; }
            if (!jobs.has(label)) throw Error('Not loaded');
            return '\n program = ' + jobs.get(label) + '\n';
        };
        process.env.ARTL_TARGET = selected;
        removeGUIData({ run }); finishGUIUninstall();
        assert.deepEqual(removed, [states.find(state => state.id === selected).label]);
        for (const state of states.filter(state => state.id !== selected)) {
            assert.equal(fs.readFileSync(state.paths.config, 'utf8'), 'keep other target');
            assert.equal(fs.existsSync(path.join(agents, state.label + '.plist')), true);
        }
    } finally {
        if (oldHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = oldHome;
        if (oldTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = oldTarget;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Antigravity saved backups prevent full manager cleanup', () => {
    const root = temporary();
    try {
        assert.deepEqual(savedConnectionStates(root), []);
        const state = path.join(root, 'Library/Application Support/Rasta Antigravity/codex-native.json');
        fs.mkdirSync(path.dirname(state), { recursive: true }); fs.writeFileSync(state, '{}');
        assert.deepEqual(savedConnectionStates(root), [state]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
