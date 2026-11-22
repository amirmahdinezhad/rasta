import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updatePlan } from '../bin/lib/gui-updates.js';
import { guiPaths, saveJSON } from '../bin/lib/gui-runtime.js';
import { recoverySetupPath } from '../bin/lib/recovery-setup.js';

test('a package selected by Library uses its embedded runtime despite saved state and a same-version repair feed', () => {
    const plan = updatePlan({ agentVersion: '1.1.16', flow: 'download-launch', setupInstall: true, patchMissing: true, compatibility: { compatible: true } }, '0.1.6', null,
        { agentVersion: '1.1.16', supportedAppVersions: ['0.1.6'] }, { target: 't3', supportedAppVersions: ['0.1.6'] });
    assert.equal(plan.release, null); assert.equal(plan.available, false); assert.equal(plan.supported, true);
});

test('T3 and Codex resolve independent legacy recovery paths for cleanup', () => {
    const previous = process.env.ARTL_TARGET;
    try {
        process.env.ARTL_TARGET = 'codex'; const codex = recoverySetupPath('/test-home');
        process.env.ARTL_TARGET = 't3'; const t3 = recoverySetupPath('/test-home');
        assert.equal(t3, '/test-home/Applications/Rasta T3 Setup.app'); assert.notEqual(codex, t3);
    } finally { if (previous === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = previous; }
});

test('checks of a package selected by Library are local even with a saved installation and live release configuration', async () => {
    const { nativeFixture } = await import('./helpers/native-fixture.js');
    const { checkGUIUpdates } = await import('../bin/lib/gui-updates.js');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-direct-setup-'));
    const previousHome = process.env.ARTL_CODEX_STATE_HOME, previousTarget = process.env.ARTL_TARGET;
    process.env.ARTL_CODEX_STATE_HOME = home; process.env.ARTL_TARGET = 't3';
    try {
        const bundle = await nativeFixture(path.join(home, 'host'), '0.1.6', true, 't3');
        let requests = 0;
        const result = await checkGUIUpdates({ app: bundle.app, agentVersion: '1.1.16', flow: 'download-launch', setupInstall: true }, {
            osVersion: '15.0', fetcher: async () => { requests++; throw new Error('No network expected'); },
        });
        assert.equal(requests, 0); assert.equal(result.available, false); assert.equal(result.supported, true); assert.equal(result.release, null);
    } finally {
        if (previousHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = previousHome;
        if (previousTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = previousTarget;
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test('older distribution requests preserve the host bundle and use the selected local package', async () => {
    const { nativeFixture } = await import('./helpers/native-fixture.js');
    const { execFileSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { agentVersion, readJSON } = await import('../bin/lib/gui-runtime.js');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-recovery-profile-'));
    const oldHome = process.env.ARTL_CODEX_STATE_HOME, oldTarget = process.env.ARTL_TARGET;
    process.env.ARTL_CODEX_STATE_HOME = home; process.env.ARTL_TARGET = 't3';
    try {
        const bundle = await nativeFixture(path.join(home, 'host'), '0.1.99', true, 't3');
        const before = fs.readFileSync(bundle.archive), paths = guiPaths();
        saveJSON(paths.config, { app: bundle.app, runtime: path.join(home, 'runtime'), agentVersion });
        const service = fileURLToPath(new URL('../bin/gui-service.js', import.meta.url));
        const invoke = flag => JSON.parse(execFileSync(process.execPath, [service, '--rpc', 'check', flag, '--app', bundle.app], { env: process.env, encoding: 'utf8' }));
        assert.equal(invoke('--setup').value.supported, true);
        assert.equal(readJSON(paths.config).app, bundle.app);
        assert.deepEqual(fs.readFileSync(bundle.archive), before);
    } finally {
        if (oldHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = oldHome;
        if (oldTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = oldTarget;
        fs.rmSync(home, { recursive: true, force: true });
    }
});
