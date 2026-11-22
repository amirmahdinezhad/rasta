import { planInstallation as updatePlan } from './installer-policy.js';
export { updatePlan };
import { hostCompatibility } from './host-compatibility.js';
import { hostReceipt } from './host-receipt.js';
import { connectionError, connectionFailure } from './connection-errors.js';
import { removeRecoverySetup } from './recovery-setup.js';
import { planSupportMigration, beginSupportMigration, rollbackSupportMigration, retirePriorUpdateEvent, scheduleSupportCleanup } from './support-migration.js';
import { removeGUIData, finishGUIUninstall } from './gui-uninstall.js';
import fs from 'node:fs';
import { targetId, targetName } from './app-target.js';
import { resolveT3App } from './t3.js';
import { resolveDesktopApp } from './desktop-apps.js';
import { desktopTargets } from './desktop-adapters.js';
import { resolveGoogleApp } from './google-apps.js';
import { targetDefinition, targetReleaseConfiguration } from './targets.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as asar from '@electron/asar';
import { setTimeout as delay } from 'node:timers/promises';
import { buildCodexPayload, resolveCodexApp } from './codex.js';
import { stageNative, stageManagedNative, commitNative, commitManagedNative, discardNativeStage,
    restoreNative, isCodexRunning, verifyOfficialBundle, nativePaths } from './codex-native.js';
import { guiPaths, saveJSON, readJSON, agentVersion, releaseBuildId, packageRoot, installedFonts, releaseGUIJob } from './gui-runtime.js';
import { readingDefaults, readingFile } from './reading-preferences.js';
import { requestCodexQuit } from './codex-after-quit.js';
import { installUpdateEvent, removeUpdateEvent, updateEventPaths } from './update-events.js';
import { fetchTrusted, boundedText, parseAppcast, verifyReleaseEnvelope, compareVersions, downloadArtifact, VENDOR_KEY } from './update-feed.js';

export function resolveGUIApp(app) {
    if (!path.isAbsolute(app)) throw new Error('Invalid application path.');
    if (desktopTargets.includes(targetId())) { const bundle = resolveDesktopApp(targetId(), app); if (!bundle) throw Error('Desktop application not found.'); return bundle; }
    if (['gemini', 'antigravity'].includes(targetId())) { const bundle = resolveGoogleApp(targetId(), app); if (!bundle) throw Error('Google application not found.'); return bundle; }
    if (targetId() === 't3') { const bundle = resolveT3App(app); if (!bundle) throw new Error('T3 Code application not found.'); return bundle; }
    const previous = process.env.ARTL_CODEX_APP;
    try { process.env.ARTL_CODEX_APP = app; const bundle = resolveCodexApp(); if (!bundle) throw new Error('ChatGPT/Codex application not found.'); return bundle; }
    finally { if (previous === undefined) delete process.env.ARTL_CODEX_APP; else process.env.ARTL_CODEX_APP = previous; }
}
export function releaseConfiguration() {
    const config = readJSON(path.join(packageRoot, 'bin/release-config.json'));
    return targetReleaseConfiguration(config, targetId());
}
export async function checkGUIUpdates(config, { fetcher, osVersion = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(), arch = process.arch, releaseConfig: catalog } = {}) {
    const bundle = resolveGUIApp(config.app), pkg = bundle.native ? {} : JSON.parse(asar.extractFile(bundle.archive, 'package.json'));
    const releaseConfig = catalog || releaseConfiguration(), signal = AbortSignal.timeout(30000);
    const url = new URL('https://updates.oaistatic.com/codex/app/appcast');
    const paths = guiPaths();
    const installation = readJSON(path.join(paths.support, 'update-client.json'), { id: randomUUID() });
    saveJSON(path.join(paths.support, 'update-client.json'), installation);
    for (const [key, value] of Object.entries({ installation_id: installation.id, arch, app_version: bundle.version,
        beta: 'false', 'os-version': osVersion, plan_type: 'unknown' })) url.searchParams.set(key, value);
    let appUpdate = null, appUpdateError = null;
    if (targetId() === 'codex' && !['download-install', 'download-launch'].includes(config.flow) && !config.setupInstall) {
        try {
            const response = await fetchTrusted(url, { signal, fetcher });
            const xml = await boundedText(response, 1024 * 1024);
            appUpdate = parseAppcast(xml, { arch, osVersion, currentBuild: Number(pkg.codexBuildNumber || 0) });
        } catch (error) { appUpdateError = error.message; }
    }
    let release = null, releaseError = null, policy = null;
    const applicableRelease = manifest => !releaseConfig.libraryUpdatesOnly || Boolean(manifest.libraryArtifact);
    const policyFile = path.join(paths.support, 'compatibility-policy.json');
    // Offline recovery trusts only previously authenticated metadata, never the UI cache.
    try {
        const cached = readJSON(policyFile);
        if (cached) {
            const verified = verifyReleaseEnvelope(cached, releaseConfig.publicKey, `darwin-${arch}`, targetId());
            if (applicableRelease(verified)) policy = verified;
        }
    } catch { /* An invalid cache cannot authorize a release or change compatibility policy. */ }
    const inspectCompatibility = () => hostCompatibility(bundle, { testedVersions: releaseConfig.supportedAppVersions, blockedVersions: [...(releaseConfig.blockedAppVersions || []), ...(policy?.blockedAppVersions || [])] });
    let compatibility = inspectCompatibility();
    const useNetwork = !config.setupInstall;
    if (useNetwork && releaseConfig?.feedUrl && releaseConfig.publicKey) {
        try {
            const body = await boundedText(await fetchTrusted(releaseConfig.feedUrl, { kind: 'release', signal, fetcher }), 128 * 1024);
            const envelope = JSON.parse(body);
            const verified = verifyReleaseEnvelope(envelope, releaseConfig.publicKey, `darwin-${arch}`, targetId());
            // The standalone feeds predate Library and use the old version numbering.
            if (applicableRelease(verified)) {
                release = verified;
                if (!policy || compareVersions(release.agentVersion, policy.agentVersion) >= 0) {
                    policy = release;
                    saveJSON(policyFile, envelope);
                    compatibility = inspectCompatibility();
                }
            }
        } catch (error) { release = null; releaseError = error.message; }
    }
    let patchMissing = false; try { hostReceipt(bundle); } catch { patchMissing = true; }
    const plan = updatePlan({ ...config, patchMissing, compatibility }, bundle.version, appUpdate, release, releaseConfig);
    const result = { checkedAt: new Date().toISOString(), appVersion: bundle.version, agentVersion: config.agentVersion || agentVersion,
        appUpdate, appUpdateError, ...plan, releaseBuildId, releaseConfigured: !!releaseConfig?.feedUrl, releaseError };
    saveJSON(paths.cache, result); return result;
}


function extractZip(file, destination) {
    fs.mkdirSync(destination, { recursive: true });
    execFileSync('/usr/bin/ditto', ['-x', '-k', file, destination], { stdio: 'pipe' });
}
function findApp(folder, expectedName = null) {
    const apps = fs.readdirSync(folder, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.endsWith('.app') && (!expectedName || e.name === expectedName));
    if (apps.length !== 1) throw new Error('The signed update contains an unexpected application layout.');
    return path.join(folder, apps[0].name);
}
function verifyVendorArchive(file, item, runtime) {
    const helper = path.join(runtime, 'rasta-ui');
    // CryptoKit maps the large ZIP, avoiding a second ~700 MB JS heap copy.
    execFileSync(helper, ['--verify', file, VENDOR_KEY, item.signature], { stdio: 'pipe' });
}

export function prepareGUIStage(request, { onStep } = {}) {
    const { config } = request, bundle = resolveGUIApp(config.app);
    {
        const catalog = releaseConfiguration();
        const compatibility = hostCompatibility(request.official || bundle, { testedVersions: catalog.supportedAppVersions, blockedVersions: catalog.blockedAppVersions });
        if (!compatibility.compatible) throw connectionError(compatibility.code || 'rasta-update-required', compatibility.message);
    }
    const options = { allowLocalSigning: true, onStep, payload: bundle.native ? undefined : buildCodexPayload(installedFonts(), { target: targetId() }),
        host: { app: config.app, runtime: config.runtime, agentVersion: config.agentVersion, target: targetId(), ...(bundle.desktopAdapter ? { desktopAdapter: bundle.desktopAdapter } : {}) } };
    return request.official ? stageManagedNative(bundle, request.official, options) : stageNative(bundle, options);
}

const safeStorageTargets = new Set(['t3', 'claude', 'zcode']);
const runPackageTool = promisify(execFile);
async function authorizeHostKeychain(stage, signal) {
    const target = stage.bundle.target;
    try {
        await runPackageTool(path.join(packageRoot, 'rasta-ui'),
            ['--authorize-host-keychain', target, stage.stagedApp, stage.official?.app || stage.sourceApp],
            { signal, timeout: 120_000 });
    } catch (error) {
        signal.throwIfAborted();
        throw connectionError('keychain-authorization-failed',
            'macOS could not authorize this app copy’s Keychain access. Prepare Rasta again and approve the Keychain request when you choose Launch.', error);
    }
}

function removeSupersededRuntimes(paths, config, jobFolder) {
    const runtimeName = /^\d+\.\d+\.\d+-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
    const { runtime, app } = config;
    if (typeof runtime !== 'string' || path.dirname(runtime) !== paths.runtimes ||
        !runtimeName.test(path.basename(runtime)) || !fs.lstatSync(paths.runtimes).isDirectory()) return;
    const active = fs.lstatSync(runtime);
    if (!active.isDirectory()) return;
    const receipt = hostReceipt(resolveGUIApp(app));
    if (receipt.app !== app || receipt.runtime !== runtime || receipt.agentVersion !== config.agentVersion ||
        (receipt.target || 'codex') !== targetId()) return;
    // A concurrent preparation may have created a runtime before acquiring the job lock.
    const cutoff = Math.min(active.birthtimeMs, fs.statSync(jobFolder).birthtimeMs);
    for (const entry of fs.readdirSync(paths.runtimes, { withFileTypes: true })) {
        if (!entry.isDirectory() || !runtimeName.test(entry.name)) continue;
        const candidate = path.join(paths.runtimes, entry.name);
        if (candidate !== runtime && fs.lstatSync(candidate).birthtimeMs < cutoff)
            fs.rmSync(candidate, { recursive: true, force: true });
    }
}

// All operations have fixed inputs from the signed manifest and this app's
// configuration. No renderer-supplied command, path or shell script is run.
export async function runGUIJob(job, overrides = {}) {
    const paths = guiPaths(), { config, action } = job;
    if (job.schema !== 1 || path.dirname(job.folder) !== paths.jobs || !['repair', 'prepare', 'restore'].includes(action)) throw new Error('Invalid update job.');
    const ownerFile = path.join(paths.lock, 'owner.json'), owner = readJSON(ownerFile);
    if (!job.handoffParentPid && owner?.id === job.id) saveJSON(ownerFile, { ...owner, pid: process.pid });
    const publish = overrides.publish || (value => {
        const status = { id: job.id, action, app: config.app, pid: process.pid, at: new Date().toISOString(), ...value };
        saveJSON(paths.status, status);
        if (config.managerInline) saveJSON(path.join(path.dirname(paths.support), 'Rasta Manager', `operation-${targetId()}.json`), status);
    });
    const controller = new AbortController();
    const checkCancellation = () => { if (fs.existsSync(paths.cancel)) controller.abort(); controller.signal.throwIfAborted(); };
    const cancellation = setInterval(() => { if (fs.existsSync(paths.cancel)) controller.abort(); }, 250);
    let lastProgress = 0;
    const progressFor = phase => (n, total) => {
        if (n !== total && Date.now() - lastProgress < 250) return;
        lastProgress = Date.now(); publish({ phase, progress: n / total });
    };
    const interactive = ['download-install', 'download-launch'].includes(config.flow);
    const relaunch = config.flow === 'download-launch' && action !== 'restore';
    let stage, migration, downloadFolder, priorEvent, cleanupPaths, committed = false, uninstalled = false;
    try {
        fs.rmSync(path.join(job.folder, 'once.plist'), { force: true });
        publish({ phase: config.managerInline && action === 'repair' ? 'preparing' : 'checking', progress: 0 });
        let next = { ...config, managedByRasta: true }, official = null;
        const bundle = resolveGUIApp(config.app);
        if (action === 'prepare' || (interactive && action === 'repair')) {
            const update = await (overrides.check || checkGUIUpdates)(config);
            checkCancellation();
            if (interactive && update.requiresAppUpdate) throw connectionError('app-update-required', 'Update ' + targetName() + ' to ' + update.targetVersion + ' first, using its own updater. Then return to Rasta and check again.');
            if (!interactive && !update.available) throw new Error('No update is available.');
            if (!update.supported) throw connectionError(update.compatibility?.code === 'app-verification-failed' ? 'app-verification-failed' : 'rasta-update-required', update.compatibility?.message || 'This Rasta package cannot support the installed app. Check for a newer Rasta update.');
            if (update.release) {
                publish({ phase: 'downloading-agent', progress: 0 });
                downloadFolder = fs.mkdtempSync(path.join(job.folder, 'rasta-release-'));
                const archive = path.join(downloadFolder, 'rasta.zip');
                await (overrides.download || downloadArtifact)(update.release.artifact, archive, { kind: 'release', signal: controller.signal,
                    progress: progressFor('downloading-agent') });
                const extracted = path.join(downloadFolder, 'extracted'); extractZip(archive, extracted);
                const app = findApp(extracted, targetDefinition(targetId()).setup);
                const sourceRuntime = path.join(app, 'Contents/Resources/runtime');
                const releasePackage = readJSON(path.join(sourceRuntime, 'package.json'));
                const downloadedTarget = readJSON(path.join(sourceRuntime, 'bin/release-config.json'))?.target || 'codex';
                if (downloadedTarget !== targetId()) throw new Error('Downloaded Rasta installer belongs to another application.');
                if (releasePackage?.version !== update.release.agentVersion || !fs.existsSync(path.join(sourceRuntime, 'node'))) throw new Error('Rasta archive does not match its signed release.');
                const runtime = path.join(paths.runtimes, `${update.release.agentVersion}-${randomUUID()}`);
                fs.cpSync(sourceRuntime, runtime, { recursive: true, verbatimSymlinks: true });
                next = { ...config, runtime, agentVersion: update.release.agentVersion, verifiedReleaseVersion: update.release.agentVersion };
                // The newly authenticated updater owns the rest of the job,
                // including app verification and commit. Updates to installer
                // code and pinned vendor keys therefore take effect immediately.
                // A previously signed runtime can still read the old window flag.
                const handoff = path.join(job.folder, 'job.json');
                saveJSON(handoff, { ...job, handoffParentPid: job.handoffParentPid || process.pid,
                    action: !interactive && update.appUpdate ? 'prepare' : 'repair', config: { ...next, showWindow: false } });
                execFileSync(path.join(runtime, 'node'), [path.join(runtime, 'bin/gui-service.js'), '--worker', handoff], { stdio: 'pipe', maxBuffer: 1024 * 1024 });
                const result = readJSON(paths.status);
                if (result?.id !== job.id || !['complete', 'failed', 'cancelled'].includes(result.phase)) throw new Error('The new updater did not finish its operation.');
                committed = result.phase === 'complete';
                if (committed && relaunch && !result.autoPromptError) cleanupPaths = guiPaths();
                return result.phase;
            }
            if (!interactive && update.appUpdate) {
                const item = update.appUpdate;
                publish({ phase: 'downloading-app', progress: 0 });
                const archive = path.join(job.folder, 'chatgpt.zip');
                await downloadArtifact(item, archive, { signal: controller.signal,
                    progress: progressFor('downloading-app') });
                controller.signal.throwIfAborted(); publish({ phase: 'verifying', progress: 1 });
                (overrides.verifyArchive || verifyVendorArchive)(archive, item, config.runtime);
                const extracted = path.join(job.folder, 'official'); extractZip(archive, extracted);
                official = resolveGUIApp(findApp(extracted));
                const pkg = verifyOfficialBundle(official);
                if (official.version !== item.version || Number(pkg.codexBuildNumber) !== item.build) throw new Error('Official update version does not match its feed.');
                execFileSync('/usr/bin/lipo', ['-verify_arch', item.arch === 'x64' ? 'x86_64' : 'arm64', official.executable], { stdio: 'pipe' });
            }
        }
        if (action !== 'restore') {
            checkCancellation(); publish({ phase: 'preparing', progress: 0 });
            migration = planSupportMigration(next, paths.support);
            if (migration) { priorEvent = updateEventPaths(next.app); next = { ...next, runtime: migration.runtime }; }
            stage = (overrides.stage || prepareGUIStage)({ config: next, official }, {
                onStep: preparationStep => {
                    checkCancellation();
                    if (config.managerInline) publish({ phase: 'preparing', progress: 0, preparationStep });
                },
            });
        }
        checkCancellation();
        const running = overrides.running || isCodexRunning;
        const codex = targetId() === 'codex';
        let manualQuit = false;
        if (interactive && action !== 'restore') {
            publish({ phase: 'ready-to-install', progress: 1, targetVersion: bundle.version, agentVersion: next.agentVersion });
            const approval = path.join(job.folder, 'install-request.json');
            while (readJSON(approval)?.id !== job.id) { checkCancellation(); await delay(150, undefined, { signal: controller.signal }); }
            checkCancellation(); publish({ phase: 'checking', progress: 1 });
            const latest = await (overrides.check || checkGUIUpdates)(next);
            checkCancellation();
            if (latest.requiresAppUpdate) throw connectionError('app-update-required', 'Update ' + targetName() + ' to ' + latest.targetVersion + ' first, using its own updater. Then return to Rasta and check again.');
            if (!latest.supported) throw connectionError('rasta-update-required', 'The app changed after preparation. Check for a compatible Rasta update before installing.');
            if (safeStorageTargets.has(bundle.target)) {
                publish({ phase: 'authorizing-keychain', progress: 1 });
                await (overrides.authorizeKeychain || authorizeHostKeychain)(stage, controller.signal);
                checkCancellation();
            }
            publish({ phase: 'quitting', progress: 1 });
            // Only this explicit Install approval can request normal termination.
            if (running(bundle)) {
                try {
                    const request = (overrides.quit || requestCodexQuit)(bundle.app);
                    manualQuit = codex && request === 'already-closed' && running(bundle);
                } catch (error) {
                    if (!codex) throw error;
                    // Keep the approved stage available for a normal, user-initiated quit.
                    manualQuit = true;
                }
            }
        }
        if (interactive && action === 'restore') { publish({ phase: 'quitting', progress: 1 }); if (running(bundle)) (overrides.quit || requestCodexQuit)(bundle.app); }
        publish({ phase: 'waiting-for-quit', progress: 1, targetVersion: official?.version || bundle.version,
            agentVersion: next.agentVersion, ready: true, ...(manualQuit && { manualQuit }) });
        const allowManualQuit = codex && action !== 'restore';
        const quitDeadline = interactive ? Date.now() + (allowManualQuit ? 120000 : 30000) : null;
        let closedSince = null;
        while (true) {
            checkCancellation();
            if (quitDeadline && Date.now() >= quitDeadline) throw connectionError('app-quit-failed', allowManualQuit
                ? 'Codex did not quit in time. Try again, choose Launch, then quit Codex with Command-Q if needed. Rasta will reopen it after installation.'
                : 'Codex did not quit. Finish any quit prompt, then try again.');
            if (running(bundle)) closedSince = null;
            else { closedSince ??= Date.now(); if (Date.now() - closedSince >= 1500) break; }
            await delay(250, undefined, { signal: controller.signal });
        }
        checkCancellation(); clearInterval(cancellation); publish({ phase: 'installing', progress: 1 });
        if (action === 'restore') (overrides.restore || restoreNative)(bundle);
        else {
            beginSupportMigration(migration);
            // A reinstalled host can still have old Rasta values in renderer storage.
            if (!fs.existsSync(nativePaths().state)) saveJSON(readingFile(paths.support), readingDefaults, { overwrite: false });
            if (stage.report.managedUpdate) (overrides.commitManaged || commitManagedNative)(stage); else (overrides.commit || commitNative)(stage);
            committed = true;
            saveJSON(paths.config, { ...next, initialInstall: false, setupInstall: false });
        }
        committed = true;
        if (interactive) fs.rmSync(paths.cache, { force: true });
        let autoPromptError = null;
        try { if (action === 'restore') (overrides.removeEvent || removeUpdateEvent)(next); else { const event = (overrides.installEvent || installUpdateEvent)(next); retirePriorUpdateEvent(migration, priorEvent, event); } }
        catch (error) { if (action === 'restore') throw error; autoPromptError = error.message; }
        if (action !== 'restore') {
            try { removeRecoverySetup(); }
            catch (error) { autoPromptError = [autoPromptError, 'The retired recovery app could not be removed: ' + error.message].filter(Boolean).join('\n'); }
        }
        if (relaunch) {
            publish({ phase: 'reopening', progress: 1 });
            fs.rmSync(paths.ready, { force: true });
            const launchedAt = Date.now();
            await (overrides.open || (app => execFileSync('/usr/bin/open', [app], { stdio: 'pipe' })))(bundle.app);
            if (overrides.confirmReady) await overrides.confirmReady(bundle, next.agentVersion);
            else {
                let ready = false;
                for (let i = 0; i < 120; i++) {
                    const value = readJSON(paths.ready);
                    if (running(bundle) && value?.app === bundle.app && value.agentVersion === next.agentVersion && value.at >= launchedAt) { ready = true; break; }
                    await delay(500);
                }
                if (!ready) throw connectionError('startup-unconfirmed', targetName() + ' reopened, but Rasta could not confirm that reading support started. Close and reopen the app, then check Rasta again.');
            }
        }
        if (action === 'restore') { (overrides.removeData || removeGUIData)({ jobId: job.id }); uninstalled = true; }
        publish({ phase: 'complete', progress: 1, uninstall: uninstalled, targetVersion: official?.version || bundle.version, agentVersion: next.agentVersion, restored: action === 'restore', autoPromptError });
        scheduleSupportCleanup(migration, next.agentVersion);
        if (relaunch && !autoPromptError) cleanupPaths = migration ? guiPaths(migration.to) : paths;
        return 'complete';
    } catch (error) {
        if (migration?.started && !committed) rollbackSupportMigration(migration);
        const phase = controller.signal.aborted ? 'cancelled' : 'failed';
        const message = targetId() !== 'codex' ? error.message.replaceAll('ChatGPT', targetName()).replaceAll('Codex', targetName()) : error.message;
        publish({ phase, ...connectionFailure({ message, code: error.code }, action === 'restore' ? 'removal-failed' : 'installation-failed'), installed: committed }); return phase;
    } finally {
        clearInterval(cancellation);
        const cleanup = [];
        const attempt = fn => { try { fn(); } catch (error) { cleanup.push(error.message); } };
        if (downloadFolder) attempt(() => fs.rmSync(downloadFolder, { recursive: true, force: true }));
        if (stage) attempt(() => (overrides.discard || discardNativeStage)(stage));
        // A complete/prior bundle stays in the separate verified backup.
        for (const name of ['chatgpt.zip', 'official', 'install-request.json']) attempt(() => fs.rmSync(path.join(job.folder, name), { recursive: true, force: true }));
        attempt(() => fs.rmSync(paths.cancel, { force: true }));
        if (cleanupPaths && !job.handoffParentPid) attempt(() => {
            const installed = readJSON(cleanupPaths.config);
            if (installed?.app === config.app) removeSupersededRuntimes(cleanupPaths, installed, job.folder);
        });
        if (!job.handoffParentPid && !uninstalled) attempt(() => releaseGUIJob(job.id));
        if (uninstalled && !cleanup.length) {
            try {
                await (overrides.finishUninstall || finishGUIUninstall)();
            }
            catch (error) { releaseGUIJob(job.id); publish({ phase: 'failed', error: error.message, installed: false }); return 'failed'; }
        }
        if (cleanup.length && uninstalled) {
            releaseGUIJob(job.id);
            publish({ phase: 'failed', error: 'Rasta was removed, but cleanup failed: ' + cleanup.join('\n'), installed: false });
            return 'failed';
        }
        if (cleanup.length) attempt(() => saveJSON(paths.status, { ...readJSON(paths.status), cleanupWarning: cleanup.join('\n') }));
    }
}
