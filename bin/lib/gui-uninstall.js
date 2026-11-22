import { recoverySetupPath, removeRecoverySetup } from './recovery-setup.js';
import fs from 'node:fs';
import { targetId } from './app-target.js';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { guiPaths } from './gui-runtime.js';

export function clearConnectionDownloads(target, before = Date.now()) {
    const home = process.env.ARTL_CODEX_STATE_HOME || os.homedir();
    for (const manager of ['Rasta Manager', 'Rasta Manager Local Test']) {
        const support = path.join(home, 'Library/Application Support', manager);
        const cache = path.join(support, 'connections', target);
        const progress = path.join(support, `download-${target}.json`);
        for (const file of [cache, progress]) {
            const entry = fs.statSync(file, { throwIfNoEntry: false });
            if (entry && entry.mtimeMs <= before) fs.rmSync(file, { recursive: true, force: true });
        }
    }
}

function removeRegistrations(home, support, jobId, run) {
    const domain = `gui/${process.getuid()}`;
    const owned = label => /^dev\.rasta\.(?:update\.[a-f0-9]{12}|ui\.[a-f0-9-]{36}|codex)$/.test(label);
    const removed = new Set();
    const labels = run('/bin/launchctl', ['list'], {encoding:'utf8',stdio:['pipe','pipe','pipe']}).split('\n').map(line=>line.trim().split(/\s+/).at(-1)).filter(owned);
    for (const label of labels) {
        if (label === `dev.rasta.ui.${jobId}`) continue;
        let state;
        try { state = run('/bin/launchctl',['print',`${domain}/${label}`],{encoding:'utf8',stdio:['pipe','pipe','pipe']}); } catch { continue; }
        const program = state.match(/\n\s*program = ([^\n]+)/)?.[1];
        // Job ownership follows the actual support path, including adopted names.
        if (!program?.startsWith(support + path.sep)) continue;
        run('/bin/launchctl',['bootout',`${domain}/${label}`],{stdio:['pipe','pipe','pipe']});
        let present = true;
        try { run('/bin/launchctl',['print',`${domain}/${label}`],{stdio:['pipe','pipe','pipe']}); } catch { present = false; }
        if (present) throw new Error('A Rasta background registration could not be removed.');
        removed.add(label);
    }
    const agents = path.join(home, 'Library/LaunchAgents');
    if (fs.existsSync(agents)) for (const name of fs.readdirSync(agents)) {
        if (name.endsWith('.plist') && owned(name.slice(0,-6))) {
            const text = fs.readFileSync(path.join(agents, name), 'utf8');
            if (removed.has(name.slice(0, -6)) || text.includes(support + '/')) fs.rmSync(path.join(agents,name));
        }
    }
}

/** Remove Rasta data after a successful restore, keeping only the active result and job until Library receives completion. */
export function removeGUIData({ jobId, run = execFileSync, paths = guiPaths(), target = targetId() } = {}) {
    const home = process.env.ARTL_CODEX_STATE_HOME || os.homedir();
    removeRegistrations(home, paths.support, jobId, run);
    removeRecoverySetup(recoverySetupPath(home, target), target);
    const retained = new Set(['gui-status.json', 'ui-jobs', 'ui-job.lock', 'gui-cancel']);
    for (const name of fs.readdirSync(paths.support)) {
        if (!retained.has(name)) fs.rmSync(path.join(paths.support, name), { recursive: true, force: true });
    }
    clearConnectionDownloads(target);
    const setupId = target === 'codex' ? 'dev.rasta.setup' : `dev.rasta.${target}.setup`;
    for (const relative of ['Library/Preferences/dev.rasta.setup.plist', 'Library/Caches/dev.rasta.setup', 'Library/Saved Application State/dev.rasta.setup.savedState']) fs.rmSync(path.join(home, relative.replaceAll('dev.rasta.setup', setupId)), {recursive:true,force:true});
    const launcher = path.join(home, 'Applications/Codex RTL.app');
    const marker = path.join(launcher, '.rasta-launcher');
    if (target === 'codex' && fs.existsSync(marker) && fs.readFileSync(marker,'utf8') === 'dev.rasta.codex') fs.rmSync(launcher,{recursive:true,force:true});
}

/** Remove the final job and result after the worker publishes completion. */
export function finishGUIUninstall(paths = guiPaths()) {
    fs.rmSync(paths.support, { recursive: true, force: true });
}
