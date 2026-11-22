import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import * as asar from '@electron/asar';
import { resolveConnectionApp } from './resolve-app.js';
import { targets, targetDefinition, targetReleaseConfiguration } from './targets.js';
import { hostCompatibility } from './host-compatibility.js';
import { hostReceipt } from './host-receipt.js';
import { readNativeState, verifyOfficialBundle } from './codex-native.js';
import { appFingerprint } from './update-events.js';
import { activeWorker, guiPaths, launchGUIJob, packageRoot, readJSON, releaseGUIJob, saveJSON } from './gui-runtime.js';
import { clearConnectionDownloads, finishGUIUninstall, removeGUIData } from './gui-uninstall.js';
import { acquireConnectionEngine, cachedConnectionEngine, libraryPackagePath, restoreConnectionEngine } from './connection-engine.js';
import { fetchTrusted, boundedText, verifyReleaseEnvelope, downloadArtifact, compareVersions } from './update-feed.js';
import { runtimeSupportPath } from './app-target.js';
import { fontPreferences, importFont, removeFont, selectFont } from './font-preferences.js';
import { readingDefaults, readingFile, readingPreferences, saveReadingPreferences } from './reading-preferences.js';
import { connectionError, connectionFailure, isConnectionError } from './connection-errors.js';

export const connections = Object.freeze(Object.values(targets));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const settings = () => readJSON(new URL('../manager-config.json', import.meta.url), {});
// Older records carry a channel. Only records from the public feed are still eligible.
const publicCache = record => record.channel === undefined || record.channel === 'stable';
export const managerPaths = (home = process.env.ARTL_CODEX_STATE_HOME || os.homedir()) => {
    const support = path.join(home, 'Library/Application Support', settings().localTestFeeds ? 'Rasta Manager Local Test' : 'Rasta Manager');
    return { support, cache: path.join(support, 'connections'), engines: path.join(support, 'engines'),
        lock: path.join(support, 'download.lock') };
};
/** Keep manager data until every target's recoverable installation has been removed. */
export function savedConnectionStates(home = process.env.ARTL_CODEX_STATE_HOME || os.homedir()) {
    return connections.map(target => path.join(home, 'Library/Application Support', target.support, 'codex-native.json')).filter(file => fs.existsSync(file));
}
const definition = id => { const item = targetDefinition(id); if (item.available === false) throw Error(item.reason); return item; };
function previousConnection(bundle, item) {
    const home = process.env.ARTL_CODEX_STATE_HOME || os.homedir();
    const support = path.join(home, 'Library/Application Support', item.support);
    const state = readNativeState(bundle, { support, state: path.join(support, 'codex-native.json') });
    const config = readJSON(path.join(support, 'gui-config.json'));
    if (!state?.originalLogicPreserved || !/^[a-f0-9]{64}$/.test(state.headerHash) || !fs.existsSync(state.backup) || config?.app !== bundle.app
        || config.initialInstall !== false || !config.managedByRasta) return null;
    const event = readJSON(path.join(support, 'update-event.json'));
    if (event?.app !== bundle.app || !event.enabled || !event.healthyFingerprint) return null;
    const fingerprint = appFingerprint(bundle.app);
    if (fingerprint === event.healthyFingerprint) return null;
    const ready = readJSON(path.join(support, 'renderer-ready.json'));
    const version = ready?.app === bundle.app && ready.at >= Date.parse(state.installedAt) && typeof ready.agentVersion === 'string'
        ? ready.agentVersion : null;
    return { fingerprint, version };
}
/** Detect only supported host identities. Existing installations are adopted without rewriting their state. */
export function scanConnections({ resolve = resolveConnectionApp, id } = {}) {
    const items = id ? [targetDefinition(id)] : connections;
    return items.flatMap(item => {
        try {
            const bundle = resolve(item.id, { discoverOnly: true }); if (!bundle) return [];
            if (item.available === false) return [{ ...item, app: bundle.app, hostVersion: bundle.version, hostBuild: bundle.build, installed: false, compatibility: { compatible: false, status: 'unavailable', message: item.reason } }];
            let host = null; try { host = hostReceipt(bundle); } catch {}
            const installed = host?.target === item.id && host.app === bundle.app && typeof host.runtime === 'string' && fs.existsSync(path.join(host.runtime, 'bin/gui-service.js'));
            let recovery = null;
            if (!host && ['codex', 't3', 'claude', 'zcode'].includes(item.id)) {
                try { recovery = previousConnection(bundle, item); } catch { /* Invalid receipts cannot authorize recovery. */ }
            }
            return [{ ...item, app: bundle.app, hostVersion: bundle.version, hostBuild: bundle.build, version: installed ? host.agentVersion : null,
                runtime: installed ? host.runtime : null, compatibility: hostCompatibility(bundle, { testedVersions: targetReleaseConfiguration(readJSON(new URL('../release-config.json', import.meta.url)), item.id).supportedAppVersions }), installed, recovery }];
        } catch (error) { return [{ ...item, app: null, error: error.message, installed: false }]; }
    });
}
/** Each manifest is verified against the installed signing key and requested target, independent of its URL. */
export async function checkConnection(id, { fetcher, config = settings(), bundledOnly = false } = {}) {
    if (id !== 'manager') definition(id);
    if (config.localTestFeeds) {
        const manifest = id === 'manager' ? { agentVersion: config.version }
            : verifyReleaseEnvelope(config.localTestFeeds[id], config.publicKey, `darwin-${process.arch}`, id);
        return { manifest, src: { local: true } };
    }
    const target = id === 'manager' ? 'codex' : id;
    const platform = `darwin-${process.arch}`;
    const bundled = config.bundledFeeds?.[id];
    const bundledRelease = () => {
        let manifest;
        try { manifest = verifyReleaseEnvelope(bundled, config.publicKey, platform, target); }
        catch (error) { throw connectionError('release-verification-failed', 'The bundled Rasta package could not be verified.', error); }
        if (manifest.agentVersion !== config.version || !manifest.libraryArtifact)
            throw connectionError('release-verification-failed', 'The bundled package does not match this version of Rasta.');
        return { manifest, src: { local: true } };
    };
    if (bundledOnly) return bundledRelease();
    const url = id === 'manager' ? config.feedUrl : `https://github.com/amirmahdinezhad/rasta/releases/latest/download/${definition(id).feed}`;
    let body;
    try {
        body = await boundedText(await fetchTrusted(url, { kind: 'release', signal: AbortSignal.timeout(10000), fetcher }), 128 * 1024);
    } catch (error) {
        if (bundled) return bundledRelease();
        throw error;
    }
    let manifest;
    try { manifest = verifyReleaseEnvelope(JSON.parse(body), config.publicKey, platform, target); }
    catch (error) { throw connectionError('release-verification-failed', 'The Rasta update information could not be verified. Check for updates again before downloading.', error); }
    if (id !== 'manager' && manifest.minimumManagerVersion && compareVersions(config.version, manifest.minimumManagerVersion) < 0)
        throw connectionError('manager-update-required', `Update the Rasta app to ${manifest.minimumManagerVersion} or later in Settings, then install Rasta for ${definition(id).name}.`);
    // A pre-Library release has no compact package. A new installer can still
    // prepare its bundled connection while that old release remains published.
    if (bundled && !manifest.libraryArtifact) return bundledRelease();
    return { manifest };
}
/** Return a cache entry only after checking every immutable downloaded ZIP and its extracted signature. */
export function cachedConnection(id, { run = execFileSync, matches = () => true } = {}) {
    const item = definition(id), folder = path.join(managerPaths().cache, id), record = readJSON(path.join(folder, 'record.json'));
    if (!record || !publicCache(record) || record.target !== id || !matches(record)) return null;
    try {
        const zip = path.join(folder, 'package.zip'), app = path.join(folder, item.setup);
        if (hash(zip) !== record.sha256) return null;
        run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
        const runtime = path.join(app, 'Contents/Resources/runtime');
        if (readJSON(path.join(runtime, 'package.json'))?.version !== record.version || (readJSON(path.join(runtime, 'bin/release-config.json'))?.target || 'codex') !== id) return null;
        return { ...record, runtime, app };
    } catch { return null; }
}
function matchesArtifact(file, artifact) {
    return fs.statSync(file, { throwIfNoEntry: false })?.size === artifact.size && hash(file) === artifact.sha256;
}

function copyBundledConnection(id, source, zip, artifact) {
    try {
        fs.copyFileSync(libraryPackagePath(source, id), zip, fs.constants.COPYFILE_EXCL);
        if (matchesArtifact(zip, artifact)) return true;
    } catch { /* A missing or unreadable bundle resource falls back to the signed feed. */ }
    fs.rmSync(zip, { force: true });
    return false;
}

/** Prepare one chosen package atomically. Failures retain its previous usable cached package. */
export async function downloadConnection(id, { check = checkConnection, download = downloadArtifact, run = execFileSync, validate = () => {},
    engineSource = packageRoot, startedAt = Date.now(), publish: write = value => saveJSON(path.join(managerPaths().support, `download-${id}.json`), value) } = {}) {
    const item = definition(id), paths = managerPaths(); fs.mkdirSync(paths.cache, { recursive: true });
    const managerBuildId = settings().localTestBuildId;
    const publish = value => write({ ...value, startedAt, managerBuildId });
    publish({ phase: 'checking', progress: 0 });
    let checked;
    try { checked = await check(id); } catch (error) {
        const failure = isConnectionError(error) ? error : connectionError('release-check-failed', error.message, error);
        publish({ phase: 'failed', ...connectionFailure(failure) }); throw failure;
    }
    const { manifest, src } = checked;
    const stage = fs.mkdtempSync(path.join(paths.cache, '.download-'));
    const destination = path.join(paths.cache, id), backup = path.join(paths.cache, `.previous-${randomUUID()}`);
    let releaseEngine;
    try {
        const zip = path.join(stage, 'package.zip');
        const compact = manifest.libraryArtifact;
        const engine = compact ? await acquireConnectionEngine(paths.engines, compact.engine, engineSource) : {};
        releaseEngine = engine.release;
        const artifact = engine.runtime ? compact : manifest.artifact;
        const bundled = engine.runtime && copyBundledConnection(id, engineSource, zip, artifact);
        if (!bundled && src?.local) throw connectionError('verification-failed', 'The bundled package does not match its signed release information.');
        if (!bundled) {
            let last = 0;
            const progress = (downloaded, total) => { if (downloaded !== total && Date.now() - last < 100) return; last = Date.now(); publish({ phase: 'downloading', downloaded, total, progress: total > 0 ? downloaded / total : null }); };
            publish({ phase: 'downloading', downloaded: 0, total: artifact.size, progress: 0 });
            await download(artifact, zip, { kind: 'release', signal: AbortSignal.timeout(300000), progress });
        }
        publish({ phase: 'verifying', progress: 1 });
        if (!bundled && !matchesArtifact(zip, artifact)) throw connectionError('verification-failed', `The download for ${item.name} could not be verified. Download it again before installing.`);
        run('/usr/bin/ditto', ['-x', '-k', zip, stage], { stdio: 'pipe' });
        const app = path.join(stage, item.setup), runtime = path.join(app, 'Contents/Resources/runtime');
        try {
            if (engine.runtime) restoreConnectionEngine(runtime, engine.runtime);
            run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
        }
        catch (error) { throw connectionError('verification-failed', `The Rasta download for ${item.name} has an invalid signature. Download it again.`, error); }
        if ((readJSON(path.join(runtime, 'bin/release-config.json'))?.target || 'codex') !== id || readJSON(path.join(runtime, 'package.json'))?.version !== manifest.agentVersion) throw connectionError('verification-failed', `The download does not match the Rasta release for ${item.name}. Download it again.`);
        if (compact && !engine.runtime && !cachedConnectionEngine(paths.engines, compact.engine, runtime))
            throw connectionError('verification-failed', `The shared Rasta engine does not match the signed release for ${item.name}.`);
        await validate({ runtime, app, version: manifest.agentVersion, sha256: artifact.sha256 });
        saveJSON(path.join(stage, 'record.json'), { target: id, version: manifest.agentVersion, sha256: artifact.sha256 });
        if (fs.existsSync(destination)) fs.renameSync(destination, backup);
        try { fs.renameSync(stage, destination); } catch (error) { if (fs.existsSync(backup)) fs.renameSync(backup, destination); throw error; }
        fs.rmSync(backup, { recursive: true, force: true });
        publish({ phase: 'downloaded', progress: 1, version: manifest.agentVersion });
        return { version: manifest.agentVersion };
    } catch (error) {
        const failure = isConnectionError(error) ? error : connectionError('download-failed', error.message, error);
        publish({ phase: 'failed', ...connectionFailure(failure) }); throw failure;
    }
    finally {
        fs.rmSync(stage, { recursive: true, force: true });
        releaseEngine?.();
    }
}
/** Evaluate the selected engine's own policy, including legacy T3 version gates. This probe never saves GUI configuration or stages a host. */
export function inspectConnectionRuntime(runtime, id, app, { run = execFileSync } = {}) {
    const catalog = readJSON(path.join(runtime, 'bin/release-config.json'));
    if ((catalog?.target || 'codex') !== id) return { supported: false, code: 'verification-failed', error: 'The Rasta package belongs to another app.' };
    try {
        return JSON.parse(run(path.join(runtime, 'node'), [fileURLToPath(new URL('../runtime-compatibility.js', import.meta.url)), runtime, app],
            { env: { ...process.env, ARTL_TARGET: id }, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (error) { try { return JSON.parse(error.stdout.toString()); } catch { return { supported: false, code: 'compatibility-check-failed', error: error.message }; } }
}
function unsupportedRuntimeError(plan, detected, checkedVersion) {
    const name = detected.name || detected.id;
    if (plan?.code) return connectionError(plan.code, `Rasta support for ${name} could not be checked. Prepare the installation again, or download the Rasta package again if the check keeps failing.`);
    if (!plan) return connectionError('runtime-unavailable', `The downloaded Rasta package for ${name} could not be found. Download it again.`);
    if (plan?.compatibility?.code === 'app-verification-failed') return connectionError('app-verification-failed', `${name} could not be verified. Reinstall the app from its official source, then check again.`);
    if (plan?.requiresAppUpdate) return connectionError('app-update-required', `Update ${name} to ${plan.targetVersion} first, using its own updater. Then return to Rasta and check again.`);
    return Object.assign(connectionError('rasta-update-required', `The available Rasta package does not support ${name} ${detected.hostVersion || ''}. A compatible Rasta release is needed. Check for a Rasta update later.`), { checkedVersion });
}

/** Select only this target's authenticated cache/feed. A saved GUI runtime is never an installation authority. */
export async function selectConnectionRuntime(id, detected, action, { cached = cachedConnection, inspect = inspectConnectionRuntime, check = checkConnection, download = downloadConnection, localTest = false, startedAt, publish = () => {} } = {}) {
    const probe = candidate => ({ ...candidate, plan: inspect(candidate.runtime, id, detected.app) });
    // A compatible installed engine or verified cache can repair offline. Installation
    // checks the selected feed so an obsolete cached package cannot hide a new engine.
    let inspectedCache;
    if (action === 'repair' && !localTest) {
        const local = cached(id);
        if (local && publicCache(local)) inspectedCache = probe(local);
        const candidates = [inspectedCache, detected.runtime && { runtime: detected.runtime, version: detected.version }].filter(Boolean);
        candidates.sort((a, b) => compareVersions(b.version || '0.0.0', a.version || '0.0.0'));
        for (const candidate of candidates) {
            const inspected = candidate.plan ? candidate : probe(candidate);
            if (inspected.plan.supported) return inspected;
        }
    }
    let checked;
    try { checked = await check(id); }
    catch (error) {
        throw isConnectionError(error) ? error : connectionError('release-check-failed', `Could not check for a Rasta update for ${detected.name || id}. Check your connection, then try again.`, error);
    }
    const { agentVersion: releaseVersion, artifact, libraryArtifact } = checked.manifest;
    const digests = [artifact?.sha256, libraryArtifact?.sha256].filter(Boolean);
    const matchesRelease = candidate => publicCache(candidate) && candidate.version === releaseVersion
        && (!digests.length || digests.includes(candidate.sha256));
    let selected = inspectedCache && matchesRelease(inspectedCache) ? inspectedCache : null;
    if (!selected) {
        const candidate = cached(id, { matches: matchesRelease });
        if (candidate && matchesRelease(candidate)) {
            publish({ phase: 'verifying', progress: 1 });
            selected = probe(candidate);
        }
    }
    if (!selected) {
        let validated;
        await download(id, { startedAt, check: async () => checked, validate: candidate => {
            const { plan } = probe(candidate);
            if (!plan.supported) throw unsupportedRuntimeError(plan, { id, ...detected }, candidate.version);
            validated = { sha256: candidate.sha256, plan };
        } });
        const candidate = cached(id, { matches: matchesRelease });
        if (candidate && matchesRelease(candidate))
            selected = validated?.sha256 && candidate.sha256 === validated.sha256 ? { ...candidate, plan: validated.plan } : probe(candidate);
    }
    if (selected?.plan.supported) return selected;
    throw unsupportedRuntimeError(selected?.plan, { id, ...detected }, checked.manifest.agentVersion);
}

/** Start a verified per-app worker without opening the legacy Setup window. */
export async function manageConnection(id, action, options = {}) {
    const startedAt = Date.now();
    try { return await startConnection(id, action, { ...options, startedAt }); }
    catch (error) {
        definition(id);
        saveJSON(path.join(managerPaths().support, `download-${id}.json`), { phase: 'failed', action: action === 'remove' ? 'restore' : action, startedAt,
            managerBuildId: (options.config || settings()).localTestBuildId,
            ...(action === 'recover' ? { recoveryFingerprint: options.fingerprint } : {}), ...connectionFailure(error, action === 'remove' ? 'removal-failed' : 'installation-failed') });
        throw error;
    }
}
async function startConnection(id, action, { scan = scanConnections, cached = cachedConnection, inspect = inspectConnectionRuntime, check = checkConnection, download = downloadConnection, run = execFileSync, config = settings(), fingerprint, bundled = false, resolve = resolveConnectionApp, verifyVendor = verifyOfficialBundle, startedAt } = {}) {
    definition(id); if (!['install', 'repair', 'remove', 'recover'].includes(action)) throw Error('Unknown connection operation.');
    const detected = scan({ id }).find(item => item.id === id && item.app);
    if (!detected) throw connectionError('app-not-found', 'This app could not be found. Install it on this Mac, then refresh the app list.');
    if (bundled && (action !== 'install' || !bundledReplacementAvailable(detected, config)))
        throw connectionError('release-check-failed', 'A bundled replacement is no longer available for this connection.');

    if (!detected.installed && !detected.recovery && ['install', 'remove'].includes(action)) {
        const job = firstInstallationJob(detected);
        if (job && (action === 'remove' || preparationFromDifferentBuild(job, config))) {
            const result = await discardPreparedConnection(id, detected, job, { run, scan });
            if (action === 'remove') return result;
        }
    }
    const recovery = ['recover', 'repair'].includes(action) || (id === 'zcode' && action === 'install') ? detected.recovery : null;
    if (action === 'recover' && (!recovery || recovery.fingerprint !== fingerprint || detected.compatibility?.compatible !== true))
        throw connectionError('recovery-unavailable', 'This app changed again. Open its Installation tab to check recovery.');
    if (recovery) {
        const bundle = resolve(id);
        if (bundle?.app !== detected.app || appFingerprint(bundle.app) !== recovery.fingerprint)
            throw connectionError('recovery-unavailable', 'This app changed again. Open its Installation tab to check recovery.');
        try { verifyVendor(bundle); }
        catch (error) { throw connectionError('app-verification-failed', `${detected.name} could not be verified. Reinstall it from its official source, then try again.`, error); }
    }
    let selected;
    const localTest = Boolean(config.localTestFeeds);
    if (action === 'recover' && id !== 'zcode' && !localTest) {
        const candidate = cached(id);
        if (!candidate || candidate.version !== recovery.version)
            throw connectionError('recovery-unavailable', 'The previous Rasta package could not be verified. Prepare recovery from the Installation tab.');
        const plan = inspect(candidate.runtime, id, detected.app);
        if (!plan.supported) throw unsupportedRuntimeError(plan, detected, candidate.version);
        selected = candidate;
        saveJSON(path.join(managerPaths().support, `download-${id}.json`), { phase: 'downloaded', action, version: selected.version, startedAt });
    } else if (action !== 'remove') {
        const publish = value => saveJSON(path.join(managerPaths().support, `download-${id}.json`), { ...value, action, startedAt, recoveryFingerprint: recovery?.fingerprint });
        publish({ phase: 'checking' });
        const checkRelease = bundled ? target => check(target, { config, bundledOnly: true }) : check;
        selected = await selectConnectionRuntime(id, detected, action === 'recover' ? 'repair' : action, { cached, inspect, check: checkRelease, download, localTest, startedAt, publish });
        publish({ phase: 'downloaded', version: selected.version });
    }
    if (recovery && appFingerprint(detected.app) !== recovery.fingerprint)
        throw connectionError('recovery-unavailable', 'This app changed again. Open its Installation tab to check recovery.');
    const runtime = action === 'remove' ? detected.runtime : selected.runtime;
    if (!runtime) throw connectionError('runtime-unavailable', 'The local Rasta package is missing. Download a verified package to continue.');
    const invoke = (args, input) => connectionRPC(runtime, id, detected.app, args, { run, input });
    if (action !== 'remove') {
        const code = fs.readFileSync(path.join(runtime, 'bin/gui-service.js'), 'utf8');
        // An installed older worker may still require manager adoption for offline repair.
        if (code.includes("action === 'manager-adopt'"))
            invoke(['--rpc', 'manager-adopt', '--manager-ui', '--manager-public']);
    }
    let job, support;
    if (action === 'remove') {
        // Older signed workers also need the flags that suppress their retired Setup window.
        support = invoke(['--support-path']);
        const paths = guiPaths(support);
        const pending = readJSON(path.join(managerPaths().support, `job-${id}.json`));
        if (pending?.support === support && pending.app === detected.app &&
            connectionOperation(id, pending)?.phase === 'ready-to-install')
            await stopPreparedConnection(pending, paths);
        const saved = readJSON(paths.config);
        if (saved?.app !== detected.app) throw Error('Rasta setup has not completed for this app.');
        job = await launchGUIJob('restore', { ...saved, managerInline: true, silentRestore: true, showWindow: false }, { paths, run });
    } else {
        const args = ['--attached-ui', '--setup', '--manager-selected-runtime'];
        support = invoke(['--support-path']);
        job = invoke(['--rpc', 'repair', '--manager-ui', ...args]);
    }
    saveJSON(path.join(managerPaths().support, `job-${id}.json`), { ...job, app: detected.app, runtime, support, action, version: selected?.version, notice: selected?.notice, recoveryFingerprint: recovery?.fingerprint,
        managerBuildId: config.localTestBuildId || null, createdAt: Date.now() });
    return { ...job, inline: true, notice: selected?.notice };
}
function connectionRPC(runtime, id, app, args, { run = execFileSync, input } = {}) {
    let output;
    try {
        output = run(path.join(runtime, 'node'), [path.join(runtime, 'bin/gui-service.js'), ...args, '--app', app],
            { env: { ...process.env, ARTL_TARGET: id }, encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input), maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
        if (!error.stdout?.length) throw error;
        output = error.stdout.toString();
    }
    const response = JSON.parse(output);
    if (!response.ok) throw Object.assign(connectionError(response.code || 'installation-failed', response.error), { checkedVersion: response.checkedVersion }); return response.value;
}
/** Approve only the selected, still-prepared job. Paths and commands never come from the web surface. */
export function launchConnection(id, jobId, { run = execFileSync, config = settings() } = {}) {
    definition(id); const job = readJSON(path.join(managerPaths().support, `job-${id}.json`));
    if (!job || job.id !== jobId) throw Error('This installation is no longer ready.');
    if (job.action === 'install' && !job.recoveryFingerprint && preparationFromDifferentBuild(job, config))
        throw Error('Prepare the installation again using this Rasta build.');
    if (job.recoveryFingerprint) {
        let fingerprint;
        try { fingerprint = appFingerprint(job.app); } catch { /* The vendor may still be replacing the app. */ }
        if (fingerprint !== job.recoveryFingerprint) {
            cancelConnection(id, jobId, { run });
            throw connectionError('recovery-unavailable', 'The app changed during preparation. Prepare recovery again once its update finishes.');
        }
    }
    return connectionRPC(job.runtime, id, job.app, ['--rpc', 'install', '--job', job.id, '--attached-ui', '--manager-ui'], { run });
}
export function cancelConnection(id, jobId, { run = execFileSync } = {}) {
    definition(id); const job = readJSON(path.join(managerPaths().support, `job-${id}.json`));
    if (!job || job.id !== jobId) throw Error('This operation is no longer active.');
    return connectionRPC(job.runtime, id, job.app, ['--rpc', 'cancel', '--attached-ui', '--manager-ui'], { run });
}
async function stopPreparedConnection(job, paths) {
    const status = readJSON(paths.status);
    if (status?.id !== job.id || status.phase !== 'ready-to-install') throw Error('This operation is no longer active.');
    // The worker checks this flag while it waits for Launch, even if its manager package was replaced.
    fs.writeFileSync(paths.cancel, 'cancel');
    const deadline = Date.now() + 30000;
    while (activeWorker(paths)) {
        if (Date.now() >= deadline) throw Error('The installer is still stopping. Try removing Rasta again from Library.');
        await delay(250);
    }
    releaseGUIJob(job.id, paths);
}
async function discardPreparedConnection(id, detected, job, { run, scan }) {
    const home = process.env.ARTL_CODEX_STATE_HOME || os.homedir();
    const paths = guiPaths(path.join(home, 'Library/Application Support', definition(id).support));
    const backup = path.join(paths.support, 'codex-native.json');
    if (job.support !== paths.support || job.app !== detected.app || detected.recovery || fs.existsSync(backup))
        throw Error('This connection has a saved installation. Restore it before clearing its data.');
    await stopPreparedConnection(job, paths);
    fs.mkdirSync(paths.lock);
    let removed = false;
    try {
        const status = readJSON(paths.status);
        if (status?.id !== job.id || !['cancelled', 'ready-to-install'].includes(status.phase) || fs.existsSync(backup) ||
            scan({ id }).some(item => item.installed || item.recovery))
            throw Error('The connection changed during removal. Refresh Library and try again.');
        removeGUIData({ paths, target: id, run });
        const result = { id: job.id, app: job.app, action: 'restore', phase: 'complete', restored: true, progress: 1, at: new Date().toISOString() };
        finishGUIUninstall(paths);
        removed = true;
        const { support } = managerPaths();
        const regular = path.join(path.dirname(support), 'Rasta Manager');
        saveJSON(path.join(support, `operation-${id}.json`), result);
        if (regular !== support) saveJSON(path.join(regular, `operation-${id}.json`), result);
        saveJSON(path.join(support, `job-${id}.json`), { ...job, action: 'remove' });
        return result;
    } finally {
        if (!removed) fs.rmSync(paths.lock, { recursive: true, force: true });
    }
}
function firstInstallationJob(app) {
    if (app.installed || app.recovery || !app.app) return null;
    const { support } = managerPaths();
    const parent = path.dirname(support);
    const hostSupport = path.join(parent, definition(app.id).support);
    const status = readJSON(guiPaths(hostSupport).status);
    if (status?.phase !== 'ready-to-install') return null;
    for (const folder of ['Rasta Manager', 'Rasta Manager Local Test']) {
        const job = readJSON(path.join(parent, folder, `job-${app.id}.json`));
        if (job?.id === status.id && job.action === 'install' && job.app === app.app && job.support === hostSupport &&
            connectionOperation(app.id, job)?.phase === 'ready-to-install') return { ...job, managerSupport: path.join(parent, folder) };
    }
    return null;
}
function preparationFromDifferentBuild(job, config) {
    const current = config.localTestBuildId || null;
    if (job.managerSupport && job.managerSupport !== managerPaths().support) return true;
    if (job.managerBuildId !== undefined) return job.managerBuildId !== current;
    if (!/^[a-f0-9-]{36}$/.test(job.id)) return false;
    const worker = readJSON(path.join(job.support, 'ui-jobs', job.id, 'job.json'));
    const runtime = worker?.config?.runtime;
    if (typeof runtime !== 'string' || path.dirname(runtime) !== path.join(job.support, 'ui-runtimes')) return false;
    const receipt = readJSON(path.join(runtime, 'package.json'));
    return receipt ? (receipt.localTestBuildId || null) !== current : false;
}
function workerAlive(pid) {
    try {
        return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes('/bin/gui-service.js --worker ');
    } catch { return false; }
}

function removalProcessAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
}

export function connectionOperation(id, job) {
    if (targetDefinition(id).available === false) return null;
    definition(id);
    if (job === undefined) job = readJSON(path.join(managerPaths().support, `job-${id}.json`));
    if (!job) return null;
    const { support } = managerPaths();
    const mirrorFile = `operation-${id}.json`;
    const mirrored = readJSON(path.join(support, mirrorFile));
    // Older connection workers always mirror to the regular manager, even for a local test build.
    const regularSupport = path.join(path.dirname(support), 'Rasta Manager');
    const legacy = support === regularSupport ? mirrored : readJSON(path.join(regularSupport, mirrorFile));
    const matchingMirror = mirrored?.id === job.id ? mirrored : legacy;
    const terminalMirror = matchingMirror?.id === job.id && ['complete', 'cancelled', 'failed'].includes(matchingMirror.phase) ? matchingMirror : null;
    const status = readJSON(path.join(job.support, 'gui-status.json'));
    if (!status && !terminalMirror && job.action !== 'remove' && legacy?.phase === 'complete' && legacy.restored &&
        legacy.app === job.app && Date.parse(legacy.at) > job.createdAt) return null;
    const current = status?.id === job.id ? status : terminalMirror;
    const value = current ? { ...current, notice: job.notice, startedAt: job.createdAt } : null;
    if (value?.phase === 'complete' && value.restored) {
        // A restore worker's final cleanup can still fail after it writes its result.
        if (value.pid && workerAlive(value.pid)) return { ...value, phase: 'installing' };
        clearConnectionDownloads(id, Date.parse(value.at) || job.createdAt);
        return value;
    }
    if (value?.phase === 'failed' && ['installation-failed', 'removal-failed'].includes(value.code)) {
        // Older signed runtimes persisted the native error under a generic reason.
        return { ...value, ...connectionFailure({ message: value.error, code: value.code, checkedVersion: value.checkedVersion }) };
    }
    if (value && ['complete', 'failed', 'cancelled'].includes(value.phase)) return value;
    if (job.action === 'remove' && !fs.existsSync(job.support) && fs.existsSync(job.app)) {
        try { hostReceipt({ app: job.app, target: id }); }
        catch {
            clearConnectionDownloads(id, job.createdAt);
            return { id: job.id, action: 'restore', phase: 'complete', restored: true, progress: 1, startedAt: job.createdAt };
        }
    }
    if (value?.pid) {
        if (!workerAlive(value.pid)) {
            // The worker may have written completion between reading its status and checking its PID.
            const latest = readJSON(path.join(job.support, 'gui-status.json'));
            const result = latest?.id === job.id ? latest : readJSON(path.join(managerPaths().support, `operation-${id}.json`));
            if (result?.id === job.id && ['complete', 'failed', 'cancelled'].includes(result.phase))
                return { ...result, startedAt: job.createdAt, notice: job.notice };
            return { ...value, action: job.action, phase: 'failed', code: 'installer-stopped', error: 'The installer stopped before the operation finished.' };
        }
    } else if (Date.now() - job.createdAt > 60000) {
        return { id: job.id, action: job.action, startedAt: job.createdAt, phase: 'failed', code: 'installer-not-started', error: 'The installer did not start.' };
    }
    if (value?.phase === 'ready-to-install' && /^[a-f0-9-]{36}$/.test(job.id)
        && readJSON(path.join(job.support, 'ui-jobs', job.id, 'install-request.json'))?.id === job.id)
        return { ...value, phase: 'checking', progress: 1 };
    return value || { id: job.id, phase: 'starting', action: job.action, startedAt: job.createdAt };
}

/** Run each installed connection's existing restore worker and keep its outcome visible in Settings. */
export async function removeConnections({ scan = scanConnections, remove = manageConnection, operation = connectionOperation, alive = workerAlive, wait = delay } = {}) {
    const file = path.join(managerPaths().support, 'removal.json');
    const previous = readJSON(file);
    if (previous?.phase === 'removing' && removalProcessAlive(previous.pid)) throw Error('Removal is already running.');
    const apps = scan().filter(item => item.installed || firstInstallationJob(item))
        .map(({ id, name }) => ({ id, name, phase: 'queued' }));
    const result = { phase: 'removing', apps, startedAt: Date.now(), pid: process.pid };
    const publish = () => saveJSON(file, result);
    publish();
    for (const item of apps) {
        item.phase = 'removing'; publish();
        try {
            const job = await remove(item.id, 'remove');
            item.job = job.id; publish();
            const deadline = Date.now() + 180000;
            while (true) {
                const status = operation(item.id);
                if (status?.id === job.id && ['complete', 'failed', 'cancelled'].includes(status.phase)
                    && (!status.pid || !alive(status.pid))) {
                    if (status.phase !== 'complete' || !status.restored) throw Error(status.error || 'Removal did not finish.');
                    break;
                }
                if (Date.now() >= deadline) throw Error('Removal is taking longer than expected. Check this connection in Library.');
                await wait(250);
            }
            item.phase = 'complete';
        } catch (error) {
            item.phase = 'failed'; item.error = error.message;
        }
        publish();
    }
    result.phase = apps.some(item => item.phase === 'failed') ? 'failed' : 'complete';
    publish();
    return result;
}
function connectionPreferencesPaths(id, scan = scanConnections) {
    definition(id); const detected = scan().find(item => item.id === id);
    const home = process.env.ARTL_CODEX_STATE_HOME || os.homedir();
    const support = detected?.runtime && runtimeSupportPath(detected.runtime, home) || path.join(home, 'Library/Application Support', targetDefinition(id).support);
    return { preferences: path.join(support, 'font-preferences.json'), directory: path.join(support, 'custom-fonts'), reading: readingFile(support) };
}
export function managerPreferences(id, { scan } = {}) {
    const paths = connectionPreferencesPaths(id, scan);
    return { ...fontPreferences(paths), reading: readingPreferences(paths.reading) || readingDefaults };
}
export function changeConnectionPreferences(id, action, input, { scan } = {}) {
    const paths = connectionPreferencesPaths(id, scan);
    if (action === 'font-import') importFont(input, paths);
    else if (action === 'font-remove') removeFont(input?.id, paths);
    else if (action === 'font-select') selectFont(input?.id, paths);
    else if (action === 'reading-save') saveReadingPreferences(input, paths.reading);
    else throw Error('Unknown reading setting.');
    return managerPreferences(id, { scan });
}
function installedBuild(item, key) {
    if (!item.installed || !item.runtime) return null;
    try { return readJSON(path.join(item.runtime, 'package.json'))?.[key]; }
    catch { return null; }
}

function bundledReplacementAvailable(item, config) {
    if (!item.installed || !item.version || !config.bundledFeeds?.[item.id]) return false;
    const order = compareVersions(item.version, config.version);
    return order > 0 || (order === 0 && Boolean(config.releaseBuildId)
        && installedBuild(item, 'releaseBuildId') !== config.releaseBuildId);
}

function confirmedStartupAfterFailure(item, job, operation) {
    if (!item.installed || item.app !== job?.app || operation?.phase !== 'failed' || operation.installed !== true ||
        !['installation-failed', 'startup-unconfirmed'].includes(operation.code)) return false;
    try {
        const paths = guiPaths(job.support);
        const state = readNativeState(item, { support: paths.support, state: path.join(paths.support, 'codex-native.json') });
        const installedAt = Date.parse(state?.installedAt);
        const ready = readJSON(paths.ready);
        return installedAt >= job.createdAt && ready?.app === item.app && ready.agentVersion === item.version && ready.at >= installedAt;
    } catch { return false; }
}

export function managerStatus({ scan = scanConnections, config = settings() } = {}) {
    const { support, cache } = managerPaths();
    const coreUpdate = readJSON(path.join(support, 'core-update.json'));
    const removal = readJSON(path.join(support, 'removal.json'));
    if (removal?.phase === 'removing' && !removalProcessAlive(removal.pid)) {
        removal.phase = 'failed';
        removal.apps = removal.apps.map(item => ['queued', 'removing'].includes(item.phase)
            ? { ...item, phase: 'failed', error: 'Removal was interrupted. Check this connection in Library.' } : item);
    }
    // Read job results before discovery so a completed restore cannot be
    // paired with a scan that still saw the patched app.
    const jobs = new Map(connections.map(({ id }) => {
        const job = readJSON(path.join(support, `job-${id}.json`));
        return [id, { job, operation: connectionOperation(id, job) }];
    }));
    const found = new Map(scan().map(item => [item.id, item]));
    const localTest = Boolean(config.localTestFeeds);
    return { version: config.version, localTest, coreUpdate: coreUpdate && publicCache(coreUpdate) ? coreUpdate : null,
        removal: removal && { ...removal, apps: removal.apps.map(item => {
            const current = item.phase === 'removing' && item.job ? jobs.get(item.id)?.operation : null;
            return { ...item, operation: current?.id === item.job ? current?.phase : undefined };
        }) },
        apps: connections.flatMap(target => {
            const discovered = found.get(target.id);
            const prepared = discovered && firstInstallationJob(discovered);
            const current = jobs.get(target.id);
            const job = prepared || current.job;
            const operation = prepared && prepared.id !== current.job?.id
                ? connectionOperation(target.id, prepared) : current.operation;
            const working = operation && !['complete', 'failed', 'cancelled'].includes(operation.phase);
            if (!discovered && !working) return [];
            // Preserve the active connection while an atomic bundle swap briefly hides the app from discovery.
            const item = working && !discovered?.app ? { ...target, app: job.app, installed: false } : discovered;
            const cachedRecord = readJSON(path.join(cache, item.id, 'record.json'));
            const record = cachedRecord && publicCache(cachedRecord) ? cachedRecord : null;
            const download = readJSON(path.join(support, `download-${item.id}.json`));
            const fingerprint = item.recovery?.fingerprint;
            const hasRecoveryPackage = record && record.version === item.recovery?.version;
            const autoRecovery = Boolean(fingerprint && item.compatibility?.compatible
                && (hasRecoveryPackage || (item.id === 'zcode' && item.recovery.version))
                && download?.recoveryFingerprint !== fingerprint && job?.recoveryFingerprint !== fingerprint);
            // Local Test builds can replace a failed package at the same version.
            const localTestFirstInstall = localTest && config.localTestBuildId && !item.installed && !item.recovery;
            const previousTestFailure = localTestFirstInstall && job?.action === 'install'
                && operation?.phase === 'failed' && preparationFromDifferentBuild(job, config);
            const previousTestDownload = localTestFirstInstall && download?.phase === 'failed' && !['restore', 'remove'].includes(download.action)
                && (download.managerBuildId !== undefined ? download.managerBuildId !== config.localTestBuildId
                    : previousTestFailure && download.startedAt <= job.createdAt);
            const localTestBuildAvailable = localTest && Boolean(config.localTestBuildId && config.localTestFeeds[item.id])
                ? installedBuild(item, 'localTestBuildId') !== config.localTestBuildId : undefined;
            const stalePreparation = Boolean(prepared && preparationFromDifferentBuild(prepared, config));
            const visibleOperation = previousTestFailure || stalePreparation ? null : operation;
            const completedStartup = confirmedStartupAfterFailure(item, job, visibleOperation);
            const bundledVersion = bundledReplacementAvailable(item, config)
                ? config.version : undefined;
            return [{ ...item, localTestBuildAvailable, bundledVersion, autoRecovery, stalePreparation, cachedVersion: stalePreparation ? null : record?.version || null,
                operation: completedStartup ? { id: operation.id, action: operation.action, phase: 'complete', progress: 1, startedAt: operation.startedAt } : visibleOperation,
                download: previousTestDownload || stalePreparation ? null : download }];
        }) };
}
/** Core updates have a separate signed feed and never update or remove host connections. */
export async function downloadManagerUpdate() {
    const { manifest } = await checkConnection('manager');
    if (compareVersions(manifest.agentVersion, settings().version) <= 0) throw Error('Rasta is up to date.');
    fs.mkdirSync(managerPaths().support, { recursive: true });
    const folder = fs.mkdtempSync(path.join(managerPaths().support, 'core-update-'));
    const zip = path.join(folder, 'Rasta.zip');
    const publish = value => saveJSON(path.join(managerPaths().support, 'core-update.json'), value);
    try {
        publish({ phase: 'downloading', version: manifest.agentVersion, progress: 0 });
        let last = 0;
        const progress = (downloaded, total) => { if (downloaded !== total && Date.now() - last < 150) return; last = Date.now(); publish({ phase: 'downloading', version: manifest.agentVersion, downloaded, total, progress: total > 0 ? downloaded / total : null }); };
        await downloadArtifact(manifest.artifact, zip, { kind: 'release', progress });
        publish({ phase: 'verifying', version: manifest.agentVersion, progress: 1 });
        execFileSync('/usr/bin/ditto', ['-x', '-k', zip, folder]);
        const app = path.join(folder, 'Rasta.app'); execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
        const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents/Info.plist')]));
        if (info.CFBundleIdentifier !== 'dev.rasta.manager' || info.CFBundleShortVersionString !== manifest.agentVersion) throw Error('Invalid Rasta update package.');
        saveJSON(path.join(managerPaths().support, 'core-prepared.json'), { app, version: manifest.agentVersion });
        publish({ phase: 'ready', version: manifest.agentVersion, progress: 1 });
        return { ready: true, message: 'Rasta update verified. Choose Restart and update to finish here.' };
    } catch (error) { publish({ phase: 'failed', error: error.message }); fs.rmSync(folder, { recursive: true, force: true }); throw error; }
}
/** The native bridge supplies its own bundle and PID; the renderer cannot select a destination. */
export async function installManagerUpdate(app, parentPid) {
    if (typeof app !== 'string' || !path.isAbsolute(app) || path.basename(app) !== 'Rasta.app' || !Number.isSafeInteger(parentPid) || parentPid <= 0) throw Error('Invalid Rasta update destination.');
    const { support } = managerPaths();
    const record = readJSON(path.join(support, 'core-prepared.json'));
    const preparedApp = typeof record?.app === 'string' ? record.app : '';
    const prepared = path.dirname(preparedApp);
    if (path.basename(preparedApp) !== 'Rasta.app' || path.dirname(prepared) !== support ||
        !/^core-update-[a-zA-Z0-9]{6}$/.test(path.basename(prepared)) ||
        !fs.lstatSync(prepared, { throwIfNoEntry: false })?.isDirectory()) throw Error('Download a Rasta update first.');
    if (!publicCache(record)) throw Error('Download a Rasta update first.');
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', record.app]);
    const folder = fs.mkdtempSync(path.join(support, 'core-installer-'));
    const runtime = fileURLToPath(new URL('../../', import.meta.url));
    try {
        fs.copyFileSync(path.join(runtime, 'node'), path.join(folder, 'node')); fs.chmodSync(path.join(folder, 'node'), 0o755);
        fs.copyFileSync(new URL('../manager-core-update.js', import.meta.url), path.join(folder, 'install.mjs'));
        saveJSON(path.join(folder, 'request.json'), { ...record, destination: app, parentPid, status: path.join(support, 'core-update.json') });
        const child = spawn(path.join(folder, 'node'), [path.join(folder, 'install.mjs'), path.join(folder, 'request.json')], { detached: true, stdio: 'ignore' });
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); }); child.unref();
    } catch (error) {
        fs.rmSync(folder, { recursive: true, force: true });
        throw error;
    }
    return { restarting: true };
}
