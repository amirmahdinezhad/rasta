import { it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as asar from '@electron/asar';
import { nativeFixture } from './helpers/native-fixture.js';
import { resolveT3App } from '../bin/lib/t3.js';
import { createCodexArchive, stageNative, commitNative, stageManagedNative, commitManagedNative, discardNativeStage, restoreNative, nativePaths, verifyInstalledNative } from '../bin/lib/codex-native.js';
import { runGUIJob, updatePlan, releaseConfiguration } from '../bin/lib/gui-updates.js';
import { guiPaths, saveJSON, readJSON, activeWorker } from '../bin/lib/gui-runtime.js';

it('keeps the T3 host signing requirement usable by the native updater after patching', { skip: os.platform() !== 'darwin' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-t3-updater-'));
    const saved = process.env.ARTL_CODEX_STATE_HOME;
    let stage;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const original = await nativeFixture(path.join(dir, 'original'), '0.1.5', true, 't3');
        const update = await nativeFixture(path.join(dir, 'update'), '0.1.6', true, 't3');
        // A stable fixture requirement models a vendor certificate requirement
        // without needing a Developer ID private key on the test machine.
        const requirement = 'identifier "dev.rasta.fixture" and info[CFBundlePackageType] = "APPL"';
        execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--requirements', '=designated => ' + requirement, original.app], { stdio: 'pipe' });
        stage = stageNative(resolveT3App(original.app), { allowLocalSigning: true });
        const designated = execFileSync('/usr/bin/codesign', ['-d', '-r-', stage.stagedApp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const installedRequirement = designated.match(/^(?:# )?designated => (.+)$/m)?.[1];
        assert.ok(installedRequirement);
        // Squirrel validates the downloaded app against the host's requirement.
        execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--test-requirement', '=' + installedRequirement, update.app], { stdio: 'pipe' });
        execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', stage.stagedApp], { stdio: 'pipe' });
        execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', 'dev.rasta.unrelated', path.join(update.app, 'Contents/Info.plist')]);
        execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', update.app], { stdio: 'pipe' });
        assert.throws(() => execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--test-requirement', '=' + installedRequirement, update.app], { stdio: 'pipe' }));
    } finally {
        if (stage) discardNativeStage(stage);
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('authorizes the exact prepared T3 copy after Launch and leaves the host open on denial', { skip: os.platform() !== 'darwin' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-keychain-launch-'));
    const saved = { home: process.env.ARTL_CODEX_STATE_HOME, target: process.env.ARTL_TARGET };
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        process.env.ARTL_TARGET = 't3';
        const app = await nativeFixture(path.join(dir, 'app'), '0.1.11', true, 't3');
        const folder = path.join(guiPaths().jobs, 'keychain');
        fs.mkdirSync(folder, { recursive: true });
        const job = { schema: 1, id: 'keychain', folder, action: 'repair',
            config: { app: app.app, runtime: dir, agentVersion: '2.0.0', flow: 'download-launch' } };
        const stagedApp = path.join(dir, 'Prepared.app');
        const expected = [];
        const overrides = {
            stage: () => ({ bundle: app, stagedApp, report: {} }),
            check: async () => ({ supported: true }),
            publish: value => {
                expected.push(value.phase);
                if (value.phase === 'ready-to-install') {
                    assert.ok(!expected.includes('authorize'));
                    saveJSON(path.join(folder, 'install-request.json'), { id: job.id });
                }
            },
            running: () => !expected.includes('quit'),
            quit: () => { expected.push('quit'); },
            open: () => { expected.push('open'); },
            commit: () => { expected.push('commit'); },
            confirmReady() {}, discard() {}, installEvent() {},
        };
        async function authorize(stage, signal) {
            assert.equal(stage.stagedApp, stagedApp);
            assert.equal(signal.aborted, false);
            expected.push('authorize');
        }
        assert.equal(await runGUIJob(job, { ...overrides, async authorizeKeychain(...args) {
            await authorize(...args);
            throw Error('Authorization declined.');
        } }), 'failed');
        assert.ok(expected.includes('authorize'));
        for (const phase of ['quit', 'commit', 'open']) assert.ok(!expected.includes(phase));
        expected.length = 0;
        fs.mkdirSync(folder, { recursive: true });
        assert.equal(await runGUIJob(job, { ...overrides, authorizeKeychain: authorize }), 'complete');
        assert.deepEqual(expected.filter(value => ['ready-to-install', 'authorizing-keychain', 'authorize', 'quit', 'commit', 'open'].includes(value)),
            ['ready-to-install', 'authorizing-keychain', 'authorize', 'quit', 'commit', 'open']);
    } finally {
        if (saved.home === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved.home;
        if (saved.target === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = saved.target;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('repairs the installed Codex after capability checks even when a newer vendor release exists', () => {
    const catalog = { supportedAppVersions: ['26.1027.61615'] };
    const config = { agentVersion: '1.1.15', flow: 'download-launch', compatibility: { compatible: true, tested: false } };
    for (const version of ['26.1027.51404', '26.1027.61615', '26.1028.10000']) {
        const plan = updatePlan(config, version, { version: '26.9999.1' }, null, catalog);
        assert.equal(plan.supported, true);
        assert.equal(plan.targetVersion, version);
        assert.equal(plan.requiresAppUpdate, false);
        assert.equal(plan.available, false, 'vendor releases do not create a Rasta update dot');
    }
    assert.equal(updatePlan({ ...config, compatibility: { compatible: false } }, '26.1028.1', null, null, catalog).supported, false);
    assert.equal(updatePlan({ ...config, compatibility: undefined }, '26.1027.61615', null, null, catalog).supported, false, 'a tested version still requires local checks');
});

it('adds a separate native bridge while preserving every original JavaScript descriptor and byte', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-host-'));
    try {
        const bundle = await nativeFixture(dir, undefined, false), output = path.join(dir, 'patched.asar');
        const report = createCodexArchive(bundle.archive, output, '// rtl', { host: { app: bundle.app, runtime: '/support/runtime' } });
        assert.equal(report.originalDataHash, report.preservedDataHash);
        assert.equal(JSON.parse(asar.extractFile(output, 'package.json')).main, 'rasta/main.cjs');
        assert.equal(JSON.parse(asar.extractFile(output, 'rasta/host.json')).originalMain, '.vite/build/main.js');
        for (const name of ['.vite/build/main.js', '.vite/build/preload.js', 'webview/assets/original.js']) {
            assert.deepEqual(asar.extractFile(output, name), asar.extractFile(bundle.archive, name));
            const descriptor = header => name.split('/').reduce((node, part) => node.files[part], header);
            assert.deepEqual(descriptor(asar.getRawHeader(output).header), descriptor(asar.getRawHeader(bundle.archive).header));
        }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('keeps a pristine NEW-version restore backup and rolls back a failed managed swap', { skip: os.platform() !== 'darwin' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-managed-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    let stage;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const old = await nativeFixture(path.join(dir, 'installed')), next = await nativeFixture(path.join(dir, 'download'), '26.1014.100');
        stage = stageNative(old, { allowLocalSigning: true, payload: '// old rtl' }); commitNative(stage); discardNativeStage(stage); stage = null;
        const before = fs.readFileSync(old.archive), priorState = fs.readFileSync(nativePaths().state), pristine = fs.readFileSync(next.archive);
        const verifySource = () => ({ name: 'fixture' }); // Fixtures are locally signed; production pins the vendor requirement.
        stage = stageManagedNative(old, next, { payload: '// new rtl', verifySource });
        const rename = fs.renameSync;
        const fault = mock.method(fs, 'renameSync', (from, to) => { if (to === nativePaths().state) throw new Error('simulated state failure'); return rename(from, to); });
        try { assert.throws(() => commitManagedNative(stage, { verifySource }), /simulated state failure/); } finally { fault.mock.restore(); }
        assert.deepEqual(fs.readFileSync(old.archive), before);
        assert.deepEqual(fs.readFileSync(nativePaths().state), priorState);
        assert.deepEqual(fs.readFileSync(next.archive), pristine);
        discardNativeStage(stage); stage = null;
        stage = stageManagedNative(old, next, { payload: '// new rtl', verifySource });
        assert.throws(() => commitManagedNative(stage, { verifySource, verifyInstalled() { throw new Error('simulated activation failure'); } }), /simulated activation failure/);
        assert.deepEqual(fs.readFileSync(old.archive), before);
        assert.deepEqual(fs.readFileSync(nativePaths().state), priorState);
        assert.deepEqual(fs.readFileSync(next.archive), pristine);
        discardNativeStage(stage); stage = null;
        stage = stageManagedNative(old, next, { payload: '// new rtl', verifySource });
        commitManagedNative(stage, { verifySource }); discardNativeStage(stage); stage = null;
        const state = readJSON(nativePaths().state), backupArchive = path.join(state.backup, 'Contents/Resources/app.asar');
        assert.deepEqual(fs.readFileSync(backupArchive), pristine);
        assert.equal(JSON.parse(asar.extractFile(old.archive, 'package.json')).version, next.version);
        verifyInstalledNative({ ...old, version: next.version });
        assert.equal(restoreNative({ ...old, version: next.version }), true);
        assert.deepEqual(fs.readFileSync(old.archive), pristine, 'restore keeps the updated version, not the displaced old app');
    } finally {
        if (stage) discardNativeStage(stage);
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('waits for manual quit, supports cancellation, and does not commit unsupported releases', { skip: os.platform() !== 'darwin' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-gui-flow-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const app = await nativeFixture(path.join(dir, 'app'), releaseConfiguration().supportedAppVersions[0], false), paths = guiPaths();
        const config = { app: app.app, runtime: dir, agentVersion: '2.0.0' }, folder = path.join(paths.jobs, 'fixture'); fs.mkdirSync(folder, { recursive: true });
        const job = { schema: 1, id: 'fixture', folder, action: 'repair', config };
        let committed = 0, running = 0, discarded = 0, phases = [];
        const overrides = { installEvent: () => {}, removeEvent: () => {}, stage: () => ({ report: {} }), commit: () => { committed++; }, verifyInstalled() {}, discard: () => { discarded++; },
            running: () => ++running < 3, publish: value => phases.push(value.phase) };
        assert.equal(await runGUIJob(job, overrides), 'complete');
        assert.equal(committed, 1); assert.ok(running >= 3); assert.equal(discarded, 1);
        assert.ok(phases.indexOf('waiting-for-quit') < phases.indexOf('installing'));
        phases = []; committed = 0;
        assert.equal(await runGUIJob(job, { ...overrides, publish: value => { phases.push(value.phase); if (value.phase === 'waiting-for-quit') fs.writeFileSync(paths.cancel, 'cancel'); } }), 'cancelled');
        assert.equal(committed, 0); assert.equal(fs.existsSync(paths.cancel), false);
        assert.equal(await runGUIJob(job, { ...overrides, discard() { throw new Error('fixture cleanup denied'); } }), 'complete', 'cleanup failure must not turn a verified installation into a reported failure');
        committed = 0;
        assert.equal(await runGUIJob({ ...job, action: 'prepare' }, { ...overrides, check: async () => ({ available: true, supported: false }) }), 'failed');
        assert.equal(committed, 0);
        for (const error of [
            Object.assign(new Error('write failed'), { code: 'ENOSPC' }),
            Error('Command failed: /usr/bin/codesign\nElectron Framework.framework: No space left on device\n'),
        ]) {
            let result;
            assert.equal(await runGUIJob(job, {
                ...overrides, stage() { throw error; }, publish: value => { result = value; },
            }), 'failed');
            assert.equal(result.code, 'insufficient-disk-space');
            assert.equal(result.installed, false);
            assert.equal(committed, 0);
        }
        fs.mkdirSync(paths.lock); saveJSON(path.join(paths.lock, 'owner.json'), { id: 'starting', createdAt: Date.now() });
        assert.equal(activeWorker(), true, 'startup is reserved before launchd assigns a PID');
        await assert.rejects(runGUIJob({ ...job, folder: '/tmp/foreign' }), /Invalid update job/);
    } finally {
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

for (const setupName of ['Rasta Setup.app']) it(`hands the operation to the authenticated updater from ${setupName}`, { skip: os.platform() !== 'darwin' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-handoff-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const app = await nativeFixture(path.join(dir, 'app'), '26.1016.61520', false), paths = guiPaths();
        const folder = path.join(paths.jobs, 'handoff'); fs.mkdirSync(folder, { recursive: true });
        const releaseApp = path.join(dir, 'release', setupName), runtime = path.join(releaseApp, 'Contents/Resources/runtime');
        fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ version: '2.1.0' }));
        fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
        fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), `const fs=require('fs');const file=process.argv[process.argv.indexOf('--worker')+1];const job=JSON.parse(fs.readFileSync(file));fs.writeFileSync(${JSON.stringify(paths.status)},JSON.stringify({id:job.id,phase:'complete',agentVersion:job.config.agentVersion}));fs.writeFileSync(${JSON.stringify(path.join(folder, 'new-engine-ran'))},'yes');`);
        const zip = path.join(dir, 'release.zip'); execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', releaseApp, zip]);
        const config = { app: app.app, runtime: dir, agentVersion: '2.0.0' };
        const result = await runGUIJob({ schema: 1, id: 'handoff', folder, config, action: 'prepare' }, {
            check: async () => ({ available: true, supported: true, appUpdate: null, release: { agentVersion: '2.1.0', artifact: {} } }),
            download: async (_artifact, file) => fs.copyFileSync(zip, file),
            stage() { throw new Error('The old updater must not stage this release.'); },
        });
        assert.equal(result, 'complete');
        assert.equal(fs.existsSync(path.join(folder, 'new-engine-ran')), true);
        assert.equal(readJSON(paths.status).agentVersion, '2.1.0');
        assert.equal(readJSON(path.join(folder, 'job.json')).config.showWindow, false, 'a previously signed worker must keep its old window disabled');
    } finally {
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

for (const setupName of ['Rasta Setup.app']) it(`downloads a newer handoff release without overwriting its parent archive from ${setupName}`, { skip: os.platform() !== 'darwin' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-handoff-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const app = await nativeFixture(path.join(dir, 'app'), '26.1016.61520', false), paths = guiPaths();
        const folder = path.join(paths.jobs, 'handoff'); fs.mkdirSync(folder, { recursive: true });
        const releaseApp = path.join(dir, 'release', setupName), runtime = path.join(releaseApp, 'Contents/Resources/runtime');
        fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ version: '2.1.0' }));
        fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
        fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), `const fs=require('fs');const file=process.argv[process.argv.indexOf('--worker')+1];const job=JSON.parse(fs.readFileSync(file));fs.writeFileSync(${JSON.stringify(paths.status)},JSON.stringify({id:job.id,phase:'complete',agentVersion:job.config.agentVersion}));fs.writeFileSync(${JSON.stringify(path.join(folder, 'new-engine-ran'))},'yes');`);
        const zip = path.join(dir, 'release.zip'); execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', releaseApp, zip]);
        fs.writeFileSync(path.join(folder, 'agent.zip'), 'authenticated parent download');
        const config = { app: app.app, runtime: dir, agentVersion: '2.0.0' };
        const result = await runGUIJob({ schema: 1, id: 'handoff', folder, config, action: 'prepare' }, {
            check: async () => ({ available: true, supported: true, appUpdate: null, release: { agentVersion: '2.1.0', artifact: {} } }),
            download: async (_artifact, file) => { const fd = fs.openSync(file, 'wx'); try { fs.writeFileSync(fd, fs.readFileSync(zip)); } finally { fs.closeSync(fd); } },
            stage() { throw new Error('The old updater must not stage this release.'); },
        });
        assert.equal(result, 'complete');
        assert.equal(fs.readFileSync(path.join(folder, 'agent.zip'), 'utf8'), 'authenticated parent download', 'each updater cleans only its own download');
        assert.equal(fs.existsSync(path.join(folder, 'new-engine-ran')), true);
        assert.equal(readJSON(paths.status).agentVersion, '2.1.0');
        assert.equal(readJSON(path.join(folder, 'job.json')).config.showWindow, false, 'a previously signed worker must keep its old window disabled');
    } finally {
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('requires explicit Launch approval and saves first-install reading defaults before reopening', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-click-install-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const app = await nativeFixture(path.join(dir, 'app'), '26.1016.61520', false), paths = guiPaths();
        const folder = path.join(paths.jobs, 'explicit'); fs.mkdirSync(folder, { recursive: true });
        const config = { app: app.app, runtime: dir, agentVersion: '2.2.1', flow: 'download-launch' };
        const job = { schema: 1, id: 'explicit', folder, action: 'repair', config };
        const approval = path.join(folder, 'install-request.json');
        const reading = path.join(paths.support, 'reading-preferences.json');
        const defaults = { fs: '16', lh: '1.6', isRTL: true, forceRTL: false, fixAtSign: false };
        const customized = { ...defaults, fs: '14', lh: '1.8', isRTL: false, forceRTL: true };
        let expectedReading = defaults;
        let quit = 0, committed = 0, approved = false, result;
        const overrides = { check: async () => ({ available: false, supported: true }), stage: () => ({ report: {} }),
            installEvent: () => {}, discard: () => {}, running: () => !quit,
            quit: target => { assert.equal(target, app.app); assert.equal(approved, true); quit++; },
            commit: () => { assert.equal(quit, 1); committed++; },
            open: target => { assert.equal(target, app.app); assert.deepEqual(readJSON(reading), expectedReading); },
            confirmReady: async () => {},
            publish: state => {
                result = state;
                if (state.phase === 'ready-to-install') {
                    assert.equal(quit, 0); assert.equal(committed, 0);
                    assert.deepEqual(readJSON(reading), expectedReading === defaults ? null : customized);
                    // A stale window cannot approve this job.
                    saveJSON(approval, { id: 'another-job' });
                    setTimeout(() => { assert.equal(quit, 0); approved = true; saveJSON(approval, { id: job.id }); }, 100);
                }
            } };
        assert.equal(await runGUIJob(job, { ...overrides, publish: state => { if (state.phase === 'ready-to-install') fs.writeFileSync(paths.cancel, 'cancel'); } }), 'cancelled');
        assert.equal(fs.existsSync(reading), false);
        assert.equal(await runGUIJob(job, overrides), 'complete'); assert.equal(committed, 1); assert.equal(result.phase, 'complete');
        assert.equal(fs.existsSync(approval), false);
        quit = 0; committed = 0;
        assert.equal(await runGUIJob(job, { ...overrides, check: async () => ({ supported: false, requiresAppUpdate: true, targetVersion: '26.9999.1' }), stage: () => { throw new Error('must not stage old Codex'); }, publish: state => { result = state; } }), 'failed');
        assert.match(result.error, /Update Codex.*first/); assert.equal(quit, 0);
        let checks = 0;
        assert.equal(await runGUIJob(job, { ...overrides, check: async () => ++checks === 1 ? { supported: true } : { requiresAppUpdate: true, targetVersion: '26.9999.2' } }), 'failed');
        assert.equal(quit, 0, 'a new official release appearing after download blocks Install before quit');
        saveJSON(reading, customized);
        expectedReading = customized;
        let manuallyClosed = false;
        assert.equal(await runGUIJob(job, {
            ...overrides,
            running: () => !manuallyClosed,
            quit: () => { throw new Error('normal quit refused'); },
            publish: state => {
                overrides.publish(state);
                if (state.phase === 'waiting-for-quit') {
                    assert.equal(state.manualQuit, true);
                    assert.equal(committed, 0);
                    manuallyClosed = true;
                }
            },
            commit: () => { assert.equal(manuallyClosed, true); committed++; },
        }), 'complete');
        assert.equal(committed, 1);
    } finally { if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved; fs.rmSync(dir, { recursive: true, force: true }); }
});


it('uses local compatibility for older and newer T3 hosts without forcing a vendor update', () => {
    const config = { agentVersion: '1.0.2', flow: 'download-launch', compatibility: { compatible: true } };
    const catalog = { target: 't3', supportedAppVersions: ['0.1.4'] };
    for (const version of ['0.1.3', '0.1.4', '0.1.5']) {
        const plan = updatePlan(config, version, null, null, catalog);
        assert.equal(plan.requiresAppUpdate, false); assert.equal(plan.targetVersion, version); assert.equal(plan.supported, true);
    }
    assert.equal(updatePlan({ ...config, compatibility: { compatible: false } }, '0.1.5', null, null, catalog).supported, false);
});

it('offers a Rasta update independently of the host version while preserving compatibility results', () => {
    const config = { agentVersion: '2.2.1', flow: 'download-install', compatibility: { compatible: true, status: 'unverified' } };
    const catalog = { supportedAppVersions: ['26.1013.40934'] };
    const release = { agentVersion: '2.2.2', supportedAppVersions: ['26.1013.40934'] };
    const result = updatePlan(config, '26.1014.1', null, release, catalog);
    assert.equal(result.available, true); assert.equal(result.supported, true);
    assert.equal(updatePlan({ ...config, initialInstall: true }, '26.1014.1', null, release, catalog).available, false, 'initial installation keeps the embedded runtime');
    assert.equal(result.compatibility.status, 'unverified');
    assert.equal(updatePlan({ ...config, compatibility: { compatible: false } }, '26.1014.1', null, release, catalog).supported, true);
});

it('Launch restarts only after approval, and requires the new renderer to confirm startup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-launch-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = dir;
    try {
        const app = await nativeFixture(path.join(dir, 'app'), '26.1016.61520', false), paths = guiPaths();
        const folder = path.join(paths.jobs, 'launch'); fs.mkdirSync(folder, { recursive: true });
        const config = { app: app.app, runtime: dir, agentVersion: '2.3.0', flow: 'download-launch' };
        const job = { schema: 1, id: 'launch', folder, action: 'repair', config };
        for (const initiallyRunning of [true, false]) {
            let running = initiallyRunning, committed = false, opened = false, result, quits = 0;
            const overrides = { check: async () => ({supported:true}), stage: () => ({report:{}}), discard() {}, installEvent() {},
                running: () => running, quit: () => { quits++; running = false; },
                commit: () => { assert.equal(running, false); committed = true; },
                open: () => { assert.equal(committed, true); opened = true; running = true; },
                confirmReady: (_bundle, version) => { assert.equal(opened, true); assert.equal(version, '2.3.0'); },
                publish: value => { result = value; if(value.phase === 'ready-to-install') { assert.equal(opened,false); assert.equal(quits,0); saveJSON(path.join(folder,'install-request.json'),{id:job.id}); } } };
            assert.equal(await runGUIJob(job,overrides),'complete'); assert.equal(quits,initiallyRunning?1:0); assert.equal(result.phase,'complete');
            running = initiallyRunning; opened = false; committed = false; quits = 0;
            assert.equal(await runGUIJob(job,{...overrides,confirmReady:()=>{throw new Error('renderer missing')}}),'failed');
            assert.equal(result.installed,true); assert.match(result.error,/renderer missing/);
        }
    } finally { if(saved===undefined)delete process.env.ARTL_CODEX_STATE_HOME;else process.env.ARTL_CODEX_STATE_HOME=saved; fs.rmSync(dir,{recursive:true,force:true}); }
});

it('reclaims old runtimes after a same-version replacement starts successfully', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-runtime-cleanup-'));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = home;
    try {
        const paths = guiPaths();
        const app = await nativeFixture(path.join(home, 'app'), '26.1016.61520', false);
        const agentVersion = '2.3.0';
        const makeRuntime = () => {
            const runtime = path.join(paths.runtimes, `${agentVersion}-${randomUUID()}`);
            fs.mkdirSync(runtime, { recursive: true });
            return runtime;
        };
        const oldRuntime = makeRuntime();
        const backup = path.join(paths.support, `codex-original-${randomUUID()}`);
        fs.mkdirSync(backup);
        const link = path.join(paths.runtimes, `${agentVersion}-${randomUUID()}`);
        fs.symlinkSync(backup, link);
        await delay(25);
        const runtime = makeRuntime();
        const folder = path.join(paths.jobs, 'cleanup');
        fs.mkdirSync(folder, { recursive: true });
        await delay(25);
        const pending = makeRuntime();
        const config = { app: app.app, runtime, agentVersion, flow: 'download-launch' };
        const job = { schema: 1, id: 'cleanup', folder, config, action: 'repair' };
        const patch = path.join(home, 'patched.asar');
        createCodexArchive(app.archive, patch, '', { host: { ...config, target: 'codex' } });
        const overrides = {
            stage: () => ({ report: {} }),
            check: async () => ({ supported: true }),
            commit: () => fs.copyFileSync(patch, app.archive),
            discard() {}, installEvent() {}, open() {}, running: () => false,
            publish: value => {
                if (value.phase === 'ready-to-install') {
                    assert.ok(fs.existsSync(oldRuntime));
                    saveJSON(path.join(folder, 'install-request.json'), { id: job.id });
                }
            },
        };
        assert.equal(await runGUIJob(job, { ...overrides, confirmReady() { throw Error('Startup unconfirmed'); } }), 'failed');
        assert.ok(fs.existsSync(oldRuntime));
        assert.equal(await runGUIJob(job, { ...overrides, confirmReady() { assert.ok(fs.existsSync(oldRuntime)); } }), 'complete');
        assert.ok(!fs.existsSync(oldRuntime));
        for (const kept of [runtime, pending, backup, link]) assert.ok(fs.existsSync(kept), kept);
    } finally {
        if (previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = previous;
        fs.rmSync(home, { recursive: true, force: true });
    }
});

it('keeps helper data when restoring the app fails', {skip: os.platform() !== 'darwin'}, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-remove-failure-'));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const app = await nativeFixture(path.join(dir, 'app'), releaseConfiguration().supportedAppVersions[0], false);
        const paths = guiPaths(), folder = path.join(paths.jobs, 'failed-restore'); fs.mkdirSync(folder,{recursive:true});
        const font = path.join(paths.support,'font-preferences.json'); fs.writeFileSync(font,'keep');
        const result = await runGUIJob({schema:1,id:'failed-restore',folder,action:'restore',config:{app:app.app,runtime:dir}}, {
            running:()=>false,restore(){throw new Error('restore denied');},removeEvent(){throw new Error('must not remove events before restore');}
        });
        assert.equal(result,'failed');
        assert.equal(fs.readFileSync(font,'utf8'),'keep');
        assert.match(readJSON(paths.status).error,/restore denied/);
    } finally {
        if(previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME=previous;
        fs.rmSync(dir,{recursive:true,force:true});
    }
});

it('restores and cleans up without reopening the host in either interactive flow', {skip: os.platform() !== 'darwin'}, async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artl-silent-remove-')),previous=process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME=dir;
        const app=await nativeFixture(path.join(dir,'app'),releaseConfiguration().supportedAppVersions[0],false);
        const paths=guiPaths(),folder=path.join(paths.jobs,'silent');fs.mkdirSync(folder,{recursive:true});
        for (const flow of ['download-launch', 'download-install']) {
            const steps = [], phases = [];
            let running = true;
            const result = await runGUIJob({schema:1,id:'silent',folder,action:'restore',config:{app:app.app,runtime:'/must-not-spawn',flow,showWindow:true}}, {
                running: () => running,
                quit: () => { steps.push('quit'); running = false; },
                restore: () => { assert.equal(running, false); steps.push('restore'); },
                removeEvent: () => steps.push('remove-event'),
                removeData: () => steps.push('remove-data'),
                finishUninstall: () => steps.push('finish'),
                open: () => steps.push('open'),
                publish: ({ phase }) => phases.push(phase),
            });
            assert.equal(result, 'complete');
            assert.deepEqual(steps, ['quit', 'restore', 'remove-event', 'remove-data', 'finish']);
            assert.deepEqual(phases, ['checking', 'quitting', 'waiting-for-quit', 'installing', 'complete']);
        }
        let opened = false;
        assert.equal(await runGUIJob({schema:1,id:'silent',folder,action:'restore',config:{app:app.app,runtime:'/must-not-spawn',flow:'download-launch'}}, {
            running:()=>false,restore:()=>{},removeEvent:()=>{},removeData:()=>{},
            finishUninstall:async()=>{throw new Error('cleanup denied');},open:()=>{opened=true;}
        }),'failed');
        assert.equal(opened,false,'a cleanup failure also leaves the host closed');
    } finally {
        if(previous===undefined)delete process.env.ARTL_CODEX_STATE_HOME;else process.env.ARTL_CODEX_STATE_HOME=previous;
        fs.rmSync(dir,{recursive:true,force:true});
    }
});
