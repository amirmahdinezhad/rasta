// End-to-end one-time installer job against a small locally signed fixture.
// Does not launch, close or modify the installed Codex app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeFixture } from './helpers/native-fixture.js';
import { recoverySetupPath } from '../bin/lib/recovery-setup.js';
import { nativePaths } from '../bin/lib/codex-native.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-gui-job-'));
const setup = path.resolve(process.env.ARTL_GUI_OUTPUT || 'dist/Rasta Setup.app');
const sourceRuntime = path.join(setup, 'Contents/Resources/runtime');
const runtime = path.join(dir, 'runtime'); fs.mkdirSync(runtime);
for (const name of ['bin', 'node', 'rasta-ui', 'node-LICENSE', 'package.json']) fs.cpSync(path.join(sourceRuntime, name), path.join(runtime, name), { recursive: true });
fs.symlinkSync(path.join(sourceRuntime, 'node_modules'), path.join(runtime, 'node_modules'));
// The fixture substitutes the network, app relaunch and access to the login
// Keychain. Signing, staging, launchd and Library approval execute real code.
const workerFile = path.join(runtime, 'bin/gui-service.js');
const workerSource = fs.readFileSync(workerFile, 'utf8');
assert.ok(workerSource.includes('await runGUIJob(readJSON(file));'));
const authorized = path.join(dir, 'authorized-fixture');
fs.writeFileSync(workerFile, workerSource.replace('await runGUIJob(readJSON(file));', `
const job = readJSON(file);
await runGUIJob(job, {
    check: async () => ({ available: false, supported: true, appUpdate: null }),
    authorizeKeychain: stage => fs.writeFileSync(${JSON.stringify(authorized)}, stage.stagedApp),
    open: () => { if (job.action === 'restore') throw Error('Removal tried to reopen the host.'); },
    confirmReady: () => {},
});`));
const node = path.join(runtime, 'node'), service = path.join(runtime, 'bin/gui-service.js');
const env = { ...process.env, ARTL_CODEX_STATE_HOME: dir };
for (const key of Object.keys(env)) if (key.startsWith('CODEX_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
const read = file => JSON.parse(fs.readFileSync(file));
try {
    const catalog = read(path.join(sourceRuntime, 'bin/release-config.json'));
    assert.ok(catalog.supportedAppVersions.length >= 1, 'the installer records inspected hosts without restricting capability-based installation');
    const app = await nativeFixture(path.join(dir, 'app'), catalog.supportedAppVersions[0], true, catalog.target || 'codex'), original = fs.readFileSync(app.archive);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const file = path.join(dir, 'signed.zip'); fs.writeFileSync(file, 'fixture for mapped CryptoKit verifier');
    const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
    const signature = sign(null, fs.readFileSync(file), privateKey).toString('base64');
    const helper = path.join(runtime, 'rasta-ui');
    execFileSync(helper, ['--verify', file, raw, signature]);
    for (const args of [['--watch', 'status', 'cancel', app.app], ['--wizard', runtime, app.app]]) {
        const retired = spawnSync(helper, args, { env, encoding: 'utf8', timeout: 3000 });
        assert.equal(retired.status, 2, 'the signed package helper rejects retired window commands');
    }
    fs.appendFileSync(file, 'tampered');
    assert.notEqual(spawnSync(helper, ['--verify', file, raw, signature]).status, 0);
    const invoke = (action, id = null) => {
        const result = JSON.parse(execFileSync(node, [service, '--rpc', action, ...(action === 'repair' ? ['--setup', '--manager-selected-runtime'] : ['--attached-ui']), '--manager-ui', '--app', app.app, ...(id ? ['--job', id] : [])], { env, encoding: 'utf8' }));
        assert.equal(result.ok, true, JSON.stringify(result)); return result.value;
    };
    const support = nativePaths(dir).support, status = path.join(support, 'gui-status.json');
    for (const action of ['repair', 'restore']) {
        const job = invoke(action); let state;
        if (action === 'repair') {
            for (let i=0;i<150;i++) { state=read(status); if (state.phase==='ready-to-install' || state.phase==='failed') break; await delay(100); }
            assert.equal(state.phase, 'ready-to-install', JSON.stringify(state));
            assert.equal(invoke('status').running, true);
            assert.equal(invoke('status').patch, 'not-patched', 'download/preparation does not install');
            assert.equal(fs.existsSync(authorized), false, 'authorization never runs before Launch');
            const stale=spawnSync(node,[service,'--rpc','install','--manager-ui','--attached-ui','--app',app.app,'--job','00000000-0000-0000-0000-000000000000'],{env,encoding:'utf8'});
            assert.notEqual(stale.status,0);
            const direct=spawnSync(node,[service,'--rpc','install','--app',app.app,'--job',job.id],{env,encoding:'utf8'});
            assert.notEqual(direct.status,0,'the renderer cannot approve Install directly');
            invoke('install',job.id);
        }
        for (let i = 0; i < 150; i++) {
            if (action === 'restore' && !fs.existsSync(support)) { state = { phase: 'complete', autoPromptError: null }; break; }
            try { state = read(status); } catch (error) { if (action === 'restore' && error.code === 'ENOENT') { state = {phase:'complete',autoPromptError:null}; break; } throw error; }
            if (state.id === job.id && ['complete', 'failed', 'cancelled'].includes(state.phase)) break;
            await delay(200);
        }
        assert.equal(state.phase, 'complete', JSON.stringify(state));
        for (let i = 0; i < 30 && fs.existsSync(path.join(support, 'ui-job.lock')); i++) await delay(100);
        assert.equal(fs.existsSync(path.join(support, 'ui-job.lock')), false);
        assert.equal(fs.existsSync(path.join(support, 'ui-jobs', job.id, 'once.plist')), false);
        const client = JSON.parse(execFileSync(node, [service, '--rpc', 'status', '--app', app.app], { env, encoding: 'utf8' })).value;
        assert.equal(client.running, false);
        assert.equal(client.patch, action === 'repair' ? 'patched-in-app' : 'not-patched');
        assert.equal(Boolean(client.patchCurrent), action === 'repair');
        assert.equal(client.localSupported, true);
        assert.equal(state.autoPromptError, null, 'recovery baseline updated without errors');
        const recovery = recoverySetupPath(dir);
        assert.equal(fs.existsSync(recovery), false, 'current connections use the central manager instead of creating a second Setup app');
        if (action === 'repair') {
            assert.equal(read(path.join(nativePaths(dir).support, 'gui-config.json')).managedByRasta, true);
            assert.equal(fs.existsSync(authorized), catalog.target === 't3', 'Launch authorizes only the applicable fixture');
        }
        if (action === 'restore') {
            for (let i = 0; i < 100 && fs.existsSync(support); i++) await delay(100);
            assert.equal(fs.existsSync(support), false, 'removal deletes fonts, settings, runtimes, logs and final status after completion');
        }
        const agents = path.join(dir, 'Library/LaunchAgents');
        assert.equal(fs.existsSync(agents) ? fs.readdirSync(agents).length : 0, 0, 'Library-managed connections do not register a background watcher');
    }
    assert.deepEqual(fs.readFileSync(app.archive), original);
    console.log('PASS: retired Setup commands rejected, connection runtime, native signature verifier, detached one-time launchd install/restore, final signature/integrity checks, explicit Install approval, clean lock/plist and no idle worker.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
