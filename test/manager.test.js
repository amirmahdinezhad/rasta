import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import * as asar from '@electron/asar';
import { signedManifest } from '../tools/release-manifest.mjs';
import { nativeFixture } from './helpers/native-fixture.js';
import { scanConnections, downloadConnection, cachedConnection, managerPaths, managerStatus, connectionOperation, manageConnection, removeConnections } from '../bin/lib/manager.js';
import { saveJSON } from '../bin/lib/gui-runtime.js';
import { appFingerprint } from '../bin/lib/update-events.js';
import { installationIssue } from '../ui/manager/src/copy.ts';

test('Library identifies a preparation worker that never started or stopped before Launch', t => {
    const support = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-manager-worker-'));
    t.after(() => fs.rmSync(support, { recursive: true, force: true }));
    const job = { id: 'zcode-preparation-fixture', support, action: 'install', createdAt: Date.now() - 61000 };
    const app = { name: 'ZCode' };

    const pending = connectionOperation('zcode', job);
    assert.equal(pending.code, 'installer-not-started');
    assert.equal(pending.startedAt, job.createdAt);
    assert.equal(installationIssue(app, pending).title, 'Rasta preparation didn’t start');

    saveJSON(path.join(support, 'gui-status.json'), { id: job.id, phase: 'ready-to-install', pid: process.pid });
    const stopped = connectionOperation('zcode', job);
    assert.equal(stopped.code, 'installer-stopped');
    assert.equal(installationIssue(app, stopped).label, 'Prepare Rasta');
});

test('Library explains disk space failures saved by older connection workers', t => {
    const support = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-manager-disk-space-'));
    t.after(() => fs.rmSync(support, { recursive: true, force: true }));
    const job = { id: 'disk-space-fixture', support, action: 'install', createdAt: Date.now() };
    const error = 'Command failed: /usr/bin/codesign\nElectron Framework.framework: No space left on device\n';
    saveJSON(path.join(support, 'gui-status.json'), { id: job.id, phase: 'failed', code: 'installation-failed', error });
    const operation = connectionOperation('t3', job);
    assert.equal(operation.code, 'insufficient-disk-space');
    assert.equal(operation.error, error);
    assert.equal(installationIssue({ name: 'T3 Code' }, operation).title, 'Not enough free disk space');
});

test('Library shows the install check once the exact T3 Launch approval is saved', t => {
    const support = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-manager-launch-'));
    t.after(() => fs.rmSync(support, { recursive: true, force: true }));
    const job = { id: 'fa328a7c-b43a-4f73-a588-222aacddf755', support, action: 'install', createdAt: Date.now() };
    const status = path.join(support, 'gui-status.json');
    const approval = path.join(support, 'ui-jobs', job.id, 'install-request.json');
    saveJSON(status, { id: job.id, phase: 'ready-to-install' });
    assert.equal(connectionOperation('t3', job).phase, 'ready-to-install');
    saveJSON(approval, { id: 'another-install' });
    assert.equal(connectionOperation('t3', job).phase, 'ready-to-install');
    saveJSON(approval, { id: job.id });
    assert.equal(connectionOperation('t3', job).phase, 'checking');
    assert.equal(connectionOperation('t3', job).progress, 1);
    saveJSON(status, { id: job.id, phase: 'complete' });
    assert.equal(connectionOperation('t3', job).phase, 'complete');
});

test('Library reconciles a committed T3 install when its new renderer confirms startup', t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-startup-status-'));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = home;
    t.after(() => {
        if (previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = previous;
        fs.rmSync(home, { recursive: true, force: true });
    });
    const app = path.join(home, 'T3 Code (Beta).app');
    const support = path.join(home, 'Library/Application Support/Rasta T3');
    const installedAt = Date.now() - 1000;
    const job = { id: 't3-reopened', app, support, action: 'install', createdAt: installedAt - 1000 };
    saveJSON(path.join(managerPaths().support, 'job-t3.json'), job);
    saveJSON(path.join(support, 'codex-native.json'), { app, version: 1, backup: path.join(support, 'codex-original-fixture'),
        installedAt: new Date(installedAt).toISOString() });
    saveJSON(path.join(support, 'gui-status.json'), { id: job.id, phase: 'failed', installed: true, code: 'installation-failed' });
    const ready = path.join(support, 'renderer-ready.json');
    const item = { id: 't3', name: 'T3 Code', app, installed: true, version: '1.1.57' };
    const status = () => managerStatus({ scan: () => [item] }).apps[0];

    saveJSON(ready, { app, agentVersion: item.version, at: installedAt - 1 });
    assert.equal(status().operation.phase, 'failed', 'the previous renderer cannot confirm a same-version replacement');
    assert.equal(installationIssue(item, status().operation).action, 'refresh');
    saveJSON(ready, { app: path.join(home, 'other.app'), agentVersion: item.version, at: installedAt + 1 });
    assert.equal(status().operation.phase, 'failed');
    saveJSON(ready, { app, agentVersion: item.version, at: installedAt + 1 });
    assert.equal(status().operation.phase, 'complete');
    assert.equal(status().version, '1.1.57');
});

test('Library never pairs completed removal with the app scan from before restoration', t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-removal-status-'));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = home;
    t.after(() => {
        if (previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = previous;
        fs.rmSync(home, { recursive: true, force: true });
    });
    const id = 'claude', app = path.join(home, 'Claude.app');
    const support = path.join(home, 'Claude worker');
    const job = { id: 'claude-removal', action: 'remove', app, support, createdAt: Date.now() };
    const managerSupport = managerPaths().support;
    const workerStatus = path.join(support, 'gui-status.json');
    saveJSON(path.join(managerSupport, 'job-claude.json'), job);
    saveJSON(workerStatus, { id: job.id, action: 'restore', phase: 'installing' });

    // Restoration completes after discovery has observed the installed app.
    let installed = true;
    const scan = () => {
        const current = { id, app, installed, version: installed ? '1.1.57' : null };
        if (installed) {
            saveJSON(workerStatus, { id: job.id, action: 'restore', phase: 'complete', restored: true });
            installed = false;
        }
        return [current];
    };
    const status = () => managerStatus({ scan }).apps.find(item => item.id === id);
    const during = status();
    assert.equal(during.operation.phase, 'installing');
    const after = status();
    assert.equal(after.operation.phase, 'complete');
    assert.equal(after.installed, false);
    assert.equal(after.version, null);
});

test('bulk removal uses independent restore jobs and reports each terminal outcome', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-remove-connections-'));
    const old = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = root;
    t.after(() => {
        if (old === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = old;
        fs.rmSync(root, { recursive: true, force: true });
    });
    const calls = [];
    let firstPoll = true;
    const result = await removeConnections({
        scan: () => [
            { id: 'codex', name: 'Codex', installed: true },
            { id: 't3', name: 'T3 Code', installed: true },
            { id: 'claude', name: 'Claude', installed: false },
        ],
        remove: async (id, action) => { calls.push([id, action]); return { id: `job-${id}` }; },
        operation: id => {
            if (id === 'codex' && firstPoll) { firstPoll = false; return { id: 'old-job', phase: 'failed' }; }
            return { id: `job-${id}`, ...(id === 'codex' ? { phase: 'complete', restored: true } : { phase: 'failed', error: 'App is still open.' }) };
        },
        wait: async () => {
            const report = JSON.parse(fs.readFileSync(path.join(managerPaths().support, 'removal.json')));
            assert.deepEqual(report.apps.map(item => item.phase), ['removing', 'queued']);
        },
    });
    assert.deepEqual(calls, [['codex', 'remove'], ['t3', 'remove']]);
    assert.equal(result.phase, 'failed');
    assert.deepEqual(result.apps.map(item => item.phase), ['complete', 'failed']);
    assert.equal(result.apps[1].error, 'App is still open.');
});

test('bulk removal discards a prepared first installation and clears only its Rasta data', async t => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-discard-prepared-')));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = home;
    t.after(() => {
        if (previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = previous;
        fs.rmSync(home, { recursive: true, force: true });
    });
    const paths = managerPaths(), id = 'antigravity';
    const support = path.join(home, 'Library/Application Support/Rasta Antigravity');
    const status = path.join(support, 'gui-status.json');
    const app = path.join(home, 'Antigravity.app');
    const idForJob = '12345678-1234-1234-1234-123456789abc';
    const workerRuntime = path.join(support, 'ui-runtimes', 'previous');
    const job = { id: idForJob, support, app, runtime: paths.cache, action: 'install', createdAt: Date.now() };
    const scan = () => [{ id, app, name: 'Antigravity', installed: false }];
    saveJSON(path.join(paths.support, `job-${id}.json`), job);
    saveJSON(path.join(support, 'ui-jobs', job.id, 'job.json'), { config: { runtime: workerRuntime } });
    saveJSON(path.join(workerRuntime, 'package.json'), { localTestBuildId: 'previous' });
    saveJSON(status, { id: job.id, phase: 'ready-to-install' });
    saveJSON(path.join(support, 'reading-preferences.json'), { fs: '22' });
    saveJSON(path.join(paths.cache, id, 'record.json'), { version: '1.1.57' });
    const otherCache = path.join(paths.cache, 't3/record.json');
    saveJSON(otherCache, { version: '1.1.55' });
    const vendor = path.join(app, 'vendor.json');
    saveJSON(vendor, { original: true });
    const run = (command, args) => {
        assert.equal(command, '/bin/launchctl');
        assert.deepEqual(args, ['list']);
        assert.equal(fs.readFileSync(path.join(support, 'gui-cancel'), 'utf8'), 'cancel');
        return '';
    };
    assert.equal(managerStatus({ scan, config: { localTestBuildId: 'previous' } }).apps[0].operation.phase, 'ready-to-install');
    const fresh = managerStatus({ scan, config: { localTestBuildId: 'next' } }).apps[0];
    assert.equal(fresh.operation, null);
    assert.equal(fresh.cachedVersion, null);
    assert.equal(fresh.stalePreparation, true);
    const previousProfile = path.join(path.dirname(paths.support), 'Rasta Manager Local Test', `job-${id}.json`);
    saveJSON(previousProfile, job);
    fs.rmSync(path.join(paths.support, `job-${id}.json`));
    assert.equal(managerStatus({ scan }).apps[0].stalePreparation, true, 'the other manager profile cannot resume an old job');
    const result = await removeConnections({ scan, remove: (target, action) => manageConnection(target, action, { run, scan }) });
    assert.equal(result.phase, 'complete', result.apps[0]?.error);
    assert.deepEqual(result.apps.map(item => [item.id, item.phase]), [[id, 'complete']]);
    const [connection] = managerStatus({ scan }).apps;
    assert.equal(connection.operation.restored, true);
    assert.equal(connection.cachedVersion, null);
    assert.equal(connection.download, null);
    assert.equal(fs.existsSync(support), false);
    assert.equal(fs.existsSync(otherCache), true);
    assert.equal(fs.existsSync(vendor), true);
});

test('Library clears legacy restore downloads while preserving a later installation attempt', t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-legacy-removal-'));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = home;
    t.after(() => {
        if (previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = previous;
        fs.rmSync(home, { recursive: true, force: true });
    });
    const { support, cache } = managerPaths();
    const job = { id: 'legacy-restore', support: path.join(home, 'removed'), action: 'remove', createdAt: Date.now() - 3000 };
    const finished = Date.now() - 1000;
    saveJSON(path.join(support, 'operation-antigravity.json'), {
        id: job.id, phase: 'complete', restored: true, at: new Date(finished).toISOString(),
    });
    const record = path.join(cache, 'antigravity/record.json');
    const download = path.join(support, 'download-antigravity.json');
    saveJSON(record, { version: '1.1.57' });
    const older = new Date(finished - 1000);
    fs.utimesSync(path.dirname(record), older, older);
    saveJSON(download, { phase: 'checking', action: 'install' });

    assert.equal(connectionOperation('antigravity', job).restored, true);
    assert.equal(fs.existsSync(record), false);
    assert.equal(fs.existsSync(download), true);
});

test('central discovery adopts both app identities without changing their original bytes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-discovery-'));
    try {
        const codex = await nativeFixture(path.join(root, 'codex'), '99.1.1');
        const t3 = await nativeFixture(path.join(root, 't3'), '0.1.99', true, 't3');
        const originals = [codex, t3].map(app => fs.readFileSync(app.archive));
        const apps = scanConnections({ resolve: id => id === 'codex' ? codex : id === 't3' ? { ...t3, target: 't3' } : null });
        assert.deepEqual(apps.map(app => app.id), ['codex', 't3']);
        assert.ok(apps.every(app => app.compatibility.compatible && !app.installed));
        for (const [index, app] of [codex, t3].entries()) assert.deepEqual(fs.readFileSync(app.archive), originals[index]);
        assert.deepEqual(scanConnections({ resolve: () => null }), []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Library offers a local test build until each host has that build installed', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-test-build-'));
    const old = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = root;
    t.after(() => {
        if (old === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = old;
        fs.rmSync(root, { recursive: true, force: true });
    });
    const build = { version: '1.1.57', localTestBuildId: 'candidate' };
    const config = { ...build, localTestFeeds: { claude: {}, codex: {} } };
    const apps = ['claude', 'codex'].map(id => ({ id, installed: true, version: build.version, runtime: path.join(root, id) }));
    const scan = () => apps;
    const offers = (manager = config) => Object.fromEntries(managerStatus({ scan, config: manager }).apps
        .map(app => [app.id, app.localTestBuildAvailable]));

    for (const app of apps) saveJSON(path.join(app.runtime, 'package.json'), { version: build.version });
    assert.deepEqual(offers(), { codex: true, claude: true }, 'an older same-version install can prepare the test build');
    saveJSON(path.join(apps[0].runtime, 'package.json'), build);
    assert.deepEqual(offers(), { codex: true, claude: false }, 'each host reports its own installed build');
    assert.deepEqual(offers({ ...config, localTestBuildId: 'next' }), { codex: true, claude: true });
    assert.deepEqual(offers({ version: build.version }), { codex: undefined, claude: undefined });
    const release = { version: build.version, releaseBuildId: 'release', bundledFeeds: { claude: {}, codex: {} } };
    const bundled = () => Object.fromEntries(managerStatus({ scan, config: release }).apps.map(app => [app.id, app.bundledVersion]));
    assert.deepEqual(bundled(), { claude: build.version, codex: build.version });
    saveJSON(path.join(apps[0].runtime, 'package.json'), { version: build.version, releaseBuildId: release.releaseBuildId });
    assert.deepEqual(bundled(), { claude: undefined, codex: build.version });

});

test('a replacement Local Test build opens a fresh Claude installation after an obsolete failure', t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-replaced-manager-'));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = home;
    t.after(() => {
        if (previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = previous;
        fs.rmSync(home, { recursive: true, force: true });
    });
    const { support: managerSupport } = managerPaths();
    const app = path.join(home, 'Claude.app');
    const support = path.join(home, 'Library/Application Support/Rasta Claude');
    const startedAt = Date.now() - 2000;
    const job = { id: 'previous-claude-install', app, support, action: 'install', createdAt: startedAt + 100,
        version: '1.1.57', managerBuildId: 'previous-build' };
    const failure = { phase: 'failed', action: 'install', code: 'installation-failed' };
    saveJSON(path.join(managerSupport, 'job-claude.json'), job);
    saveJSON(path.join(support, 'gui-status.json'), { ...failure, id: job.id });
    const download = path.join(managerSupport, 'download-claude.json');
    saveJSON(download, { ...failure, startedAt });
    const scan = () => [{ id: 'claude', name: 'Claude', app, installed: false }];
    const status = localTestBuildId => managerStatus({ scan, config: { localTestFeeds: { claude: {} }, localTestBuildId } }).apps[0];

    assert.equal(installationIssue(scan()[0], status('previous-build').operation).title, 'Couldn’t install Rasta for Claude');
    assert.equal(status('replacement-build').operation, null);
    assert.equal(status('replacement-build').download, null);

    saveJSON(download, { ...failure, startedAt: Date.now(), managerBuildId: 'replacement-build' });
    assert.equal(status('replacement-build').download.phase, 'failed', 'a new failure remains actionable');
    fs.rmSync(path.join(managerSupport, 'job-claude.json'));
    saveJSON(download, { ...failure, startedAt: Date.now(), managerBuildId: 'previous-build' });
    assert.equal(status('replacement-build').download, null, 'a failed download can identify its build without a worker');
});

test('connection cache is target-specific, validates bytes, preserves a previous package on failed download and never upgrades the core', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-manager-cache-')), old = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = root;
    try {
        const manifests = {};
        for (const [target, name] of [['codex', 'Rasta Setup.app'], ['t3', 'Rasta T3 Setup.app'], ['antigravity', 'Rasta Antigravity Setup.app'], ['claude', 'Rasta Claude Setup.app'], ['opencode', 'Rasta OpenCode Setup.app'], ['zcode', 'Rasta ZCode Setup.app']]) {
            const app = path.join(root, 'source', target, name), runtime = path.join(app, 'Contents/Resources/runtime');
            fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
            fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ version: target === 't3' ? '2.0.0' : '1.0.0' }));
            fs.writeFileSync(path.join(runtime, 'bin/release-config.json'), JSON.stringify({ target }));
            const zip = path.join(root, target + '.zip'); execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
            const data = fs.readFileSync(zip);
            manifests[target] = { data, manifest: { agentVersion: target === 't3' ? '2.0.0' : '1.0.0', artifact: { sha256: createHash('sha256').update(data).digest('hex'), size: data.length } } };
        }
        const progress = [];
        const options = { check: async id => ({ manifest: manifests[id].manifest, src: {} }), publish: value => progress.push(value),
            download: async (artifact, file, options) => { const entry = Object.values(manifests).find(item => item.manifest.artifact.sha256 === artifact.sha256); options.progress(Math.floor(entry.data.length / 2), entry.data.length); fs.writeFileSync(file, entry.data); options.progress(entry.data.length, entry.data.length); },
            run: (command, args, config) => command.endsWith('codesign') ? '' : execFileSync(command, args, config) };
        await downloadConnection('codex', options); await downloadConnection('t3', options); await downloadConnection('antigravity', options);
        for (const id of ['claude', 'opencode', 'zcode']) await downloadConnection(id, options);
        assert.ok(progress.some(value => value.phase === 'downloading' && value.downloaded > 0 && value.downloaded < value.total));
        assert.equal(progress.at(-1).phase, 'downloaded');
        const verify = { run: () => '' };
        assert.equal(cachedConnection('codex', verify).version, '1.0.0'); assert.equal(cachedConnection('t3', verify).version, '2.0.0'); assert.equal(cachedConnection('antigravity', verify).version, '1.0.0');
        await assert.rejects(downloadConnection('t3', { ...options, download: async () => { throw Error('network failure'); } }), /network failure/);
        await assert.rejects(downloadConnection('t3', { ...options, validate: () => { throw Error('host compatibility failed'); } }), /host compatibility failed/);
        assert.equal(cachedConnection('t3', verify).version, '2.0.0'); assert.equal(cachedConnection('codex', verify).version, '1.0.0');
        fs.appendFileSync(path.join(managerPaths().cache, 't3/package.zip'), 'bad');
        for (const id of ['antigravity', 'claude', 'opencode', 'zcode']) assert.equal(cachedConnection(id, verify).version, '1.0.0'); assert.equal(cachedConnection('t3', verify), null); assert.equal(cachedConnection('codex', verify).version, '1.0.0');
        await assert.rejects(downloadConnection('../codex', options), /Unknown connection/);
    } finally { if (old === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = old; fs.rmSync(root, { recursive: true, force: true }); }
});

for (const [id, name, version, needsDownload] of [
    ['t3', 'T3', '0.1.99'],
    ['claude', 'Claude', '6.6395.1'],
    ['zcode', 'ZCode', '9.0.0'],
    ['zcode', 'ZCode', '9.0.0', true],
]) test(`${name} replacement prepares a ${needsDownload ? 'new signed' : 'previously verified'} package and waits for Launch`, async () => {
    const { manageConnection, launchConnection, managerPreferences } = await import('../bin/lib/manager.js');
    const { saveJSON } = await import('../bin/lib/gui-runtime.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-manager-recovery-'));
    const old = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = root;
    try {
        const host = { ...await nativeFixture(path.join(root, 'host'), version, true, id), target: id };
        const scan = () => scanConnections({ resolve: target => target === id ? host : null });
        const support = path.join(root, 'Library/Application Support', `Rasta ${name}`);
        const backup = path.join(support, 'codex-original-test');
        const runtime = path.join(root, 'verified-package');
        fs.mkdirSync(backup, { recursive: true });
        fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), "action === 'manager-adopt';");
        saveJSON(path.join(support, 'gui-config.json'), { app: host.app, initialInstall: false, managedByRasta: true, agentVersion: '1.1.44' });
        saveJSON(path.join(support, 'update-event.json'), { app: host.app, enabled: true, healthyFingerprint: 'previous-host' });
        assert.equal(scan()[0].recovery, null, 'a config without a completed installation does not authorize recovery');
        saveJSON(path.join(support, 'codex-native.json'), { version: 1, app: host.app, backup, headerHash: 'a'.repeat(64), originalLogicPreserved: true, installedAt: new Date().toISOString() });
        saveJSON(path.join(support, 'renderer-ready.json'), { app: host.app, agentVersion: '1.1.43', at: Date.now() });
        saveJSON(path.join(support, 'reading-preferences.json'), { forceRTL: true, fs: '18' });
        const fingerprint = appFingerprint(host.app);
        const updateEvent = path.join(support, 'update-event.json');
        saveJSON(updateEvent, { app: host.app, enabled: true, healthyFingerprint: fingerprint });
        assert.equal(scan()[0].recovery, null, 'an unchanged bundle must not trigger recovery');
        saveJSON(updateEvent, { app: host.app, enabled: true, healthyFingerprint: 'previous-host' });
        const status = () => managerStatus({ scan }).apps.find(app => app.id === id);
        assert.equal(status().autoRecovery, id === 'zcode', 'only ZCode can automatically recover without a cached package');
        saveJSON(path.join(managerPaths().cache, id, 'record.json'), { channel: 'stable', version: '1.1.43' });
        assert.deepEqual(status().recovery, { fingerprint, version: '1.1.43' });
        assert.equal(status().installed, false);
        assert.equal(status().autoRecovery, true);
        const previous = { runtime, version: '1.1.43', channel: 'stable' };
        const nextRuntime = path.join(root, 'next-package');
        fs.cpSync(runtime, nextRuntime, { recursive: true });
        const replacement = { runtime: nextRuntime, version: '1.1.44', channel: 'stable', sha256: 'b'.repeat(64) };
        const checked = { manifest: { agentVersion: replacement.version, artifact: { sha256: replacement.sha256 } }, src: {} };
        let candidate = previous;
        const calls = [];
        const options = {
            scan, resolve: () => host, fingerprint, verifyVendor: bundle => { assert.equal(bundle, host); calls.push('verify-vendor'); },
            cached: () => candidate,
            inspect: engine => ({ supported: !needsDownload || engine === nextRuntime }),
            check: target => { assert.ok(needsDownload); assert.equal(target, id); calls.push('check-feed'); return checked; },
            download: async (target, { check, validate }) => {
                assert.ok(needsDownload); assert.equal(target, id); assert.equal(await check(), checked);
                validate(replacement); calls.push('download-verified'); candidate = replacement;
            },
            run: (command, args) => {
                assert.equal(command, path.join(needsDownload ? nextRuntime : runtime, 'node'));
                const action = args[args.indexOf('--rpc') + 1];
                if (args.includes('--support-path')) return JSON.stringify({ ok: true, value: support });
                calls.push(action);
                return JSON.stringify({ ok: true, value: { id: 'recovery-job', phase: 'starting' } });
            },
        };
        await assert.rejects(manageConnection(id, 'recover', { ...options, verifyVendor: undefined }), { code: 'app-verification-failed' });
        assert.deepEqual(calls, []);
        assert.equal((await manageConnection(id, 'recover', options)).id, 'recovery-job');
        assert.deepEqual(calls, ['verify-vendor', ...(needsDownload ? ['check-feed', 'download-verified'] : []), 'manager-adopt', 'repair']);
        assert.equal(status().autoRecovery, false, 'Library must not prepare the same host replacement twice');
        assert.equal(managerPreferences(id, { scan }).reading.forceRTL, true);
        const info = path.join(host.app, 'Contents/Info.plist');
        fs.utimesSync(info, new Date(), new Date(Date.now() + 5000));
        assert.throws(() => launchConnection(id, 'recovery-job', options), { code: 'recovery-unavailable' });
        assert.equal(calls.at(-1), 'cancel');
        assert.ok(!calls.includes('install'));
    } finally {
        if (old === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = old;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('manager starts per-app jobs inline and approves only its recorded job', async () => {
    const { manageConnection, launchConnection, managerPreferences, changeConnectionPreferences } = await import('../bin/lib/manager.js');
    const { saveJSON } = await import('../bin/lib/gui-runtime.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-manager-inline-')), old = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = root;
    try {
        const runtime = path.join(root, 'runtime'); fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), "action === 'manager-adopt';");
        const calls = [];
        const support = path.join(root, 'Library/Application Support/Legacy T3');
        saveJSON(path.join(support, 'gui-config.json'), { app: '/Applications/T3.app', runtime, flow: 'download-launch' });
        const run = (command, args, config) => {
            if (['/usr/bin/plutil', '/bin/launchctl'].includes(command)) { calls.push([command, ...args]); return ''; }
            assert.equal(config.env.ARTL_TARGET, 't3'); calls.push(args);
            return JSON.stringify({ ok: true, value: args.includes('--support-path') ? support : { id: 'fixture-job', phase: 'starting' } });
        };
        const options = { scan: () => [{ id: 't3', app: '/Applications/T3.app', runtime, version: '1.0.0', installed: true }], cached: () => ({ runtime, version: '1.0.0' }), run,
            inspect: () => ({ supported: true }), check: async () => ({ manifest: { agentVersion: '1.0.0' } }),
        };
        assert.equal((await manageConnection('t3', 'install', options)).inline, true);
        assert.deepEqual(calls.filter(args => args.includes('--rpc')).map(args => args[args.indexOf('--rpc') + 1]), ['manager-adopt', 'repair']);
        assert.ok(calls.at(-1).includes('--attached-ui') && calls.at(-1).includes('--manager-ui') && calls.at(-1).includes('--setup'));
        assert.ok(calls.at(-1).includes('--manager-selected-runtime'), 'the prepared package cannot delegate back to a saved obsolete engine');
        assert.throws(() => launchConnection('t3', 'another-job', { run }), /no longer ready/);
        assert.equal(launchConnection('t3', 'fixture-job', { run }).id, 'fixture-job');
        assert.ok(calls.at(-1).includes('install') && calls.at(-1).includes('--job'));
        calls.length = 0;
        const removal = await manageConnection('t3', 'remove', options);
        const jobFolder = path.join(support, 'ui-jobs', removal.id);
        const job = JSON.parse(fs.readFileSync(path.join(jobFolder, 'job.json')));
        assert.equal(job.action, 'restore');
        assert.equal(job.config.flow, 'download-install', 'legacy restore workers quit the host without reopening it');
        assert.equal(job.config.runtime, runtime);
        assert.equal(job.config.silentRestore, true);
        assert.equal(job.config.showWindow, false);
        assert.ok(!calls.some(args => args.includes('--rpc')), 'older RPC services would choose the flow that reopens the host');
        assert.deepEqual(calls.at(-1).slice(0, 2), ['/bin/launchctl', 'bootstrap']);
        const plist = JSON.parse(fs.readFileSync(path.join(jobFolder, 'once.plist')));
        assert.deepEqual(plist.ProgramArguments, [path.join(runtime, 'node'), path.join(runtime, 'bin/gui-service.js'), '--worker', path.join(jobFolder, 'job.json')]);
        calls.length = 0;
        const scan = () => [];
        const input = { name: 'Vazir.ttf', data: fs.readFileSync(new URL('../bin/assets/Vazir-Regular.ttf', import.meta.url)).toString('base64') };
        const font = changeConnectionPreferences('t3', 'font-import', input, { scan });
        assert.notEqual(font.selected, 'vazir');
        assert.equal(managerPreferences('codex', { scan }).selected, 'vazir');
        changeConnectionPreferences('t3', 'reading-save', { fs: '18', isRTL: false }, { scan });
        assert.equal(managerPreferences('t3', { scan }).reading.fs, '18');
        assert.equal(managerPreferences('codex', { scan }).reading.fs, '16');
        assert.throws(() => changeConnectionPreferences('t3', 'reading-save', { fs: '999' }, { scan }), /Invalid/);
        assert.equal(managerPreferences('t3', { scan }).reading.fs, '18');
        const codexFont = changeConnectionPreferences('codex', 'font-import', input, { scan });
        const removed = changeConnectionPreferences('t3', 'font-remove', { id: font.selected }, { scan });
        assert.equal(removed.selected, 'vazir');
        assert.deepEqual(removed.fonts, []);
        assert.equal(removed.reading.fs, '18');
        assert.equal(managerPreferences('codex', { scan }).selected, codexFont.selected);
    } finally { if (old === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = old; fs.rmSync(root, { recursive: true, force: true }); }
});

test('the public feed replaces a bundled fallback only after signature verification', async t => {
    const { checkConnection } = await import('../bin/lib/manager.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-public-feed-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const artifact = path.join(root, 'full.zip'), compact = path.join(root, 'compact.zip');
    fs.writeFileSync(artifact, 'larger full archive fixture');
    fs.writeFileSync(compact, 'compact fixture');
    const { privateKey } = generateKeyPairSync('ed25519');
    const options = { repository: 'example/rasta', artifact, platform: `darwin-${process.arch}`,
        version: '1.0.0', supportedAppVersions: [], privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const library = { file: compact, engine: 'a'.repeat(64) };
    const bundled = signedManifest({ ...options, library });
    const config = { version: options.version, publicKey: bundled.publicKey, bundledFeeds: { codex: bundled.envelope } };
    const offer = fetcher => checkConnection('codex', { config, fetcher });
    const explicit = await checkConnection('codex', { config, bundledOnly: true,
        fetcher: () => assert.fail('An explicit bundled replacement must not check the network') });
    assert.equal(explicit.manifest.agentVersion, config.version);
    assert.equal(explicit.src.local, true);

    const legacy = signedManifest({ ...options, version: '1.1.16' });
    const next = signedManifest({ ...options, library, version: '1.0.1' });
    const offline = await offer(async () => { throw Error('Offline'); });
    assert.equal(offline.manifest.agentVersion, config.version);
    assert.equal(offline.src.local, true);
    assert.equal((await offer(async () => Response.json(legacy.envelope))).manifest.agentVersion, config.version);
    assert.equal((await offer(async () => Response.json(next.envelope))).manifest.agentVersion, '1.0.1');
    await assert.rejects(offer(async () => Response.json({ ...next.envelope, signature: 'invalid' })),
        { code: 'release-verification-failed' });
});
