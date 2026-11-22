#!/usr/bin/env node
import { saveAppearance } from './lib/appearance.js';
import fs from 'node:fs';
import { targetId } from './lib/app-target.js';
import { resolveConnectionApp } from './lib/resolve-app.js';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareVersions } from './lib/update-feed.js';
import { guiPaths, readJSON, saveJSON, snapshotRuntime, launchGUIJob, activeWorker, releaseGUIJob, agentVersion, releaseBuildId, requestGUIInstall } from './lib/gui-runtime.js';
import { resolveGUIApp, checkGUIUpdates, runGUIJob, prepareGUIStage, releaseConfiguration } from './lib/gui-updates.js';
import { inspectNative, verifyInstalledNative } from './lib/codex-native.js';
import { hostReceipt } from './lib/host-receipt.js';
import { fontPreferences, importFont, removeFont, selectFont, MAX_FONT_BYTES } from './lib/font-preferences.js';
import { readingPreferences, saveReadingPreferences } from './lib/reading-preferences.js';
import { connectionFailure } from './lib/connection-errors.js';
import * as asar from '@electron/asar';

const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
async function main() {
    if (args.includes('--support-path')) return guiPaths().support;
    if (args.includes('--worker')) {
        const file = value('--worker'), paths = guiPaths();
        if (path.dirname(path.dirname(file)) !== paths.jobs || path.basename(file) !== 'job.json') throw new Error('Invalid UI job path.');
        await runGUIJob(readJSON(file)); return;
    }
    if (args.includes('--stage')) {
        const file = value('--stage');
        if (path.dirname(path.dirname(file)) !== guiPaths().jobs || path.basename(file) !== 'stage-request.json') throw new Error('Invalid staged update request.');
        saveJSON(`${file}.result`, prepareGUIStage(readJSON(file))); return;
    }
    const action = value('--rpc'), paths = guiPaths();
    const managerRequest = args.includes('--manager-ui');
    if (action === 'preferences') return { ...fontPreferences(), reading: readingPreferences() };
    if (action === 'reading-save') {
        const key = value('--reading-key'), setting = value('--reading-value');
        if (!args.includes('--reading-key') || !args.includes('--reading-value') || setting === undefined)
            throw new Error('Invalid reading setting.');
        const baseline = args.includes('--reading-baseline') ? JSON.parse(value('--reading-baseline')) : {};
        return saveReadingPreferences({ [key]: setting === 'true' ? true : setting === 'false' ? false : setting }, undefined, baseline);
    }
    if (action === 'manager-open' || action === 'open') {
        const route = `connection/${targetId()}${args.includes('--view') && value('--view') === 'reading' ? '?tab=reading' : ''}`;
        execFileSync('/usr/bin/open', ['-b', 'dev.rasta.manager', `rasta://${route}`], { stdio: 'pipe' });
        return { opened: true };
    }
    if (['repair', 'prepare', 'restore', 'install', 'cancel'].includes(action) && !managerRequest)
        throw new Error('Manage this connection from Rasta Library.');
    if (['fonts', 'font-import', 'font-select', 'font-remove', 'appearance'].includes(action)) {
        if (action === 'fonts') return fontPreferences();
        const chunks = []; let length = 0;
        for await (const chunk of process.stdin) {
            length += chunk.length;
            if (length > Math.ceil(MAX_FONT_BYTES / 3) * 4 + 1024) throw new Error('The font request is too large.');
            chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (action === 'appearance') return saveAppearance(input);
        if (action === 'font-remove') return removeFont(input?.id);
        return action === 'font-import' ? importFont(input) : selectFont(input.id);
    }
    const app = args.includes('--app') ? value('--app') : resolveConnectionApp(targetId())?.app;
    if (!app) throw new Error('ChatGPT/Codex application not found.');
    const bundle = resolveGUIApp(app);
    let config = readJSON(paths.config);
    if (action === 'manager-adopt') {
        if (!args.includes('--manager-ui')) throw Error('Connection adoption requires the Rasta manager.');
        if (activeWorker()) throw Error('An update is already running.');
        const runtime = config?.app === app ? config.runtime : snapshotRuntime(bundle);
        saveJSON(paths.config, { ...(config?.app === app ? config : { schema: 1, app, runtime, agentVersion, initialInstall: true, flow: 'download-launch' }), managedByRasta: true });
        return { adopted: true };
    }
    const fromDistribution = args.includes('--setup');
    // Only the native manager's selected package may replace a stale saved
    // engine choice. Host state, backups and preferences keep their ownership.
    const selectedByManager = fromDistribution && args.includes('--manager-ui') && args.includes('--manager-selected-runtime');
    if (fromDistribution && ['repair', 'restore', 'check', 'prepare'].includes(action)) {
        if (activeWorker()) throw new Error('An update is already running.');
        if (!selectedByManager && config?.app === app && !config.setupInstall) {
            config = { ...config, setupInstall: true };
            saveJSON(paths.config, config);
        }
        if (!selectedByManager && config?.app === app && compareVersions(config.agentVersion, agentVersion) > 0) {
            if (action === 'restore') return launchGUIJob(action, { ...config, silentRestore: true, showWindow: false });
            const response = JSON.parse(execFileSync(path.join(config.runtime, 'node'), [path.join(config.runtime, 'bin/gui-service.js'),
                '--rpc', action, '--app', app, '--attached-ui', ...(managerRequest ? ['--manager-ui'] : [])], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
            if (!response.ok) throw new Error(response.error); return response.value;
        }
        if (!config || config.app !== app || config.agentVersion !== agentVersion || action === 'repair' || !config.setupInstall) {
            const runtime = snapshotRuntime(bundle);
            config = { schema: 1, app, runtime, agentVersion, flow: 'download-launch', setupInstall: true, managedByRasta: selectedByManager || config?.managedByRasta === true, initialInstall: config?.initialInstall || !config || config.app !== app }; saveJSON(paths.config, config);
        }
    }
    if (action === 'status') {
        const running = activeWorker(); let operation = readJSON(paths.status);
        if (operation && ['starting', 'checking', 'downloading-agent', 'downloading-app', 'verifying', 'preparing', 'ready-to-install', 'authorizing-keychain', 'quitting', 'waiting-for-quit', 'installing', 'reopening'].includes(operation.phase) && !running)
            operation = { ...operation, phase: 'failed', error: 'The installer stopped. Please retry from Rasta.' };
        let patch;
        try { patch = inspectNative(bundle).state; } catch { patch = 'incompatible'; }
        let installedAgentVersion = null;
        try { installedAgentVersion = hostReceipt(bundle).agentVersion || null; } catch {}
        let healthy = patch === 'patched-in-app';
        // Distribution callers may request the expensive signature check. Widget polling stays cheap.
        if (healthy && fromDistribution) { try { verifyInstalledNative(bundle); } catch { healthy = false; } }
        const releaseConfig = releaseConfiguration();
        const cachedUpdate = readJSON(paths.cache);
        const update = !releaseConfig.libraryUpdatesOnly || (releaseBuildId && cachedUpdate?.releaseBuildId === releaseBuildId)
            ? cachedUpdate : null;
        return { app, appVersion: bundle.version, agentVersion, installedAgentVersion,
            localSupported: releaseConfig.supportedAppVersions.includes(bundle.version),
            patchCurrent: Boolean(healthy && installedAgentVersion && compareVersions(installedAgentVersion, agentVersion) >= 0),
            patch, operation, update, running };
    }
    if (!config || config.app !== app) throw new Error('Rasta setup has not completed for this app.');
    if (action === 'ready') {
        const host = hostReceipt(bundle);
        if (host.app !== app || host.runtime !== config.runtime) throw new Error('Rasta runtime does not match the installed host.');
        saveJSON(paths.ready, { app, agentVersion: host.agentVersion, at: Date.now() }); return { ready: true };
    }
    if (action === 'check') return await checkGUIUpdates({ ...config, flow: 'download-launch' });
    if (action === 'install') {
        if (!fromDistribution && !args.includes('--attached-ui')) throw new Error('Start installation from Rasta Library.');
        return requestGUIInstall(value('--job'), app);
    }
    if (action === 'cancel') { fs.writeFileSync(paths.cancel, 'cancel'); return { phase: 'cancelling' }; }
    if (!['repair', 'prepare', 'restore'].includes(action)) throw new Error('Unknown Rasta action.');
    const job = await launchGUIJob(action, { ...config, flow: 'download-launch',
        managerInline: managerRequest });
    return job;
}
main().then(value => { if (!args.includes('--worker') && !args.includes('--stage')) console.log(JSON.stringify({ ok: true, value })); })
    .catch(error => {
        if (args.includes('--worker')) {
            const paths = guiPaths(), file = value('--worker');
            if (path.dirname(path.dirname(file)) === paths.jobs) {
                const id = path.basename(path.dirname(file));
                if (readJSON(paths.status)?.id === id) saveJSON(paths.status, { id, phase: 'failed', ...connectionFailure(error) });
                releaseGUIJob(id);
            }
        }
        console.log(JSON.stringify({ ok: false, ...connectionFailure(error) })); process.exitCode = 1;
    });
