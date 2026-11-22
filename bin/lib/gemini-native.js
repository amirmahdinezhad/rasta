import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addNativeLoader, inspectNativeLoader } from './macho-loader.js';
import { hostReceipt } from './host-receipt.js';
import { assertCodexClosed, localSigningEntitlements, nativePaths, readNativeState } from './codex-native.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
const readPlist = file => JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]));
const libraryPath = bundle => path.join(path.dirname(bundle.executable), 'Rasta.dylib');
const receiptPath = bundle => path.join(bundle.app, 'Contents/Resources/rasta');
const executableHash = bundle => hash(fs.readFileSync(bundle.executable));
const verifySignature = app => run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);

export function verifyGeminiVendor(bundle) {
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--test-requirement',
        '=identifier "com.google.GeminiMacOS" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "EQHXZ8M8AV"', bundle.app]);
    const info = readPlist(path.join(bundle.app, 'Contents/Info.plist'));
    if (info.CFBundleIdentifier !== 'com.google.GeminiMacOS' || info.CFBundleShortVersionString !== bundle.version
        || info.CFBundleVersion !== bundle.build || path.join(bundle.app, 'Contents/MacOS', info.CFBundleExecutable) !== bundle.executable)
        throw Error('The Gemini vendor identity or version changed.');
}

/** Native compatibility never treats the presence of a receipt as proof of reading support. */
export function geminiCompatibility(bundle, { testedVersions = [], blockedVersions = [] } = {}) {
    const tested = testedVersions.includes(bundle.version);
    try {
        if (blockedVersions.includes(bundle.version)) throw Error('This Gemini version is blocked by the compatibility policy.');
        const bytes = fs.readFileSync(bundle.executable), layout = inspectNativeLoader(bytes);
        if (!bytes.includes(Buffer.from('_CTLineCreateWithAttributedString')) || !bytes.includes(Buffer.from('_CTFramesetterCreateWithAttributedString')))
            throw Error('Gemini needs a different native text adapter.');
        if (!layout.linked) addNativeLoader(bytes);
        else if (hostReceipt(bundle).codeHash !== layout.codeHash) throw Error('The Gemini native integration does not match its receipt.');
        return { compatible: true, tested, status: tested ? 'tested' : 'unverified',
            message: tested ? null : 'Local native compatibility checks passed. Reading support still needs to be checked inside Gemini after Launch.' };
    } catch (error) { return { compatible: false, tested, status: 'incompatible', code: 'rasta-update-required', message: error.message }; }
}

export function inspectGemini(bundle) {
    let patched = false;
    try {
        const receipt = hostReceipt(bundle), bytes = fs.readFileSync(bundle.executable), layout = inspectNativeLoader(bytes);
        patched = layout.linked && receipt.schema === 1 && receipt.target === 'gemini' && receipt.app === bundle.app
            && path.isAbsolute(receipt.runtime) && receipt.codeHash === layout.codeHash
            && hash(fs.readFileSync(libraryPath(bundle))) === receipt.libraryHash;
    } catch { /* Missing or incomplete files cannot report an installed connection. */ }
    return { state: patched ? 'patched-in-app' : 'not-patched', app: bundle.app, version: bundle.version,
        html: [], injection: 'native-core-text', signatureChangeRequired: true, backgroundProcesses: 0, launchers: 0 };
}

export function verifyInstalledGemini(bundle) {
    const state = readNativeState(bundle, nativePaths());
    if (!state || state.adapter !== 'gemini' || executableHash(bundle) !== state.headerHash || inspectGemini(bundle).state !== 'patched-in-app')
        throw Error('The installed Gemini files do not match a completed Rasta installation.');
    verifySignature(bundle.app);
    return { state: 'patched-in-app', headerHash: state.headerHash, signatureVerified: true };
}

function signGemini(app, scratch) {
    const xml = run('/usr/bin/codesign', ['-d', '--entitlements', ':-', app]);
    const original = xml.trim() ? JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: xml })) : {};
    const next = localSigningEntitlements(original), entitlements = path.join(scratch, 'gemini-entitlements.plist');
    run('/usr/bin/plutil', ['-convert', 'xml1', '-o', entitlements, '--', '-'], { input: JSON.stringify(next) });
    try {
        run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--preserve-metadata=identifier,flags,runtime', '--entitlements', entitlements, app]);
    } finally { fs.rmSync(entitlements, { force: true }); }
    return [{ target: '.', removed: Object.keys(original).filter(key => !(key in next)), added: ['com.apple.security.cs.disable-library-validation'] }];
}

export function stageGemini(bundle, { allowLocalSigning = false, host, library = path.join(root, 'bin/assets/rasta-gemini.dylib'), verifySource = verifyGeminiVendor } = {}) {
    if (!allowLocalSigning) throw Error('In-app Rasta requires local signing of Gemini. Review the signing notice in Rasta before choosing Launch.');
    if (host?.target !== 'gemini' || host.app !== bundle.app || !path.isAbsolute(host.runtime || '') || typeof host.agentVersion !== 'string') throw Error('Invalid Gemini runtime ownership.');
    const paths = nativePaths(), previous = readNativeState(bundle, paths), installedHeaderHash = executableHash(bundle);
    if (path.dirname(path.dirname(host.runtime)) !== paths.support || path.basename(path.dirname(host.runtime)) !== 'ui-runtimes')
        throw Error('The Gemini runtime belongs to a different support directory.');
    const refreshing = previous?.adapter === 'gemini' && previous.headerHash === installedHeaderHash;
    const source = refreshing ? { ...bundle, app: previous.backup, executable: path.join(previous.backup, path.relative(bundle.app, bundle.executable)) } : bundle;
    verifySignature(bundle.app); verifySource(source);
    const original = fs.readFileSync(source.executable), layout = inspectNativeLoader(original);
    if (layout.linked || fs.existsSync(receiptPath(source)) || fs.existsSync(libraryPath(source))) throw Error('Gemini already contains an unrecognized native integration.');
    const staging = fs.mkdtempSync(path.join(path.dirname(bundle.app), '.rasta-stage-')), stagedApp = path.join(staging, path.basename(bundle.app));
    const staged = { ...bundle, app: stagedApp, executable: path.join(stagedApp, path.relative(bundle.app, bundle.executable)) };
    try {
        run('/usr/bin/ditto', [source.app, stagedApp]);
        fs.writeFileSync(staged.executable, addNativeLoader(original));
        fs.copyFileSync(library, libraryPath(staged));
        run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--options', 'runtime', libraryPath(staged)]);
        const resources = receiptPath(staged); fs.mkdirSync(resources);
        fs.copyFileSync(path.join(root, 'bin/panel/panel.js'), path.join(resources, 'panel.js'));
        for (const name of ['panel.html', 'panel-bootstrap.js']) fs.copyFileSync(path.join(root, 'bin/host/gemini', name), path.join(resources, name));
        fs.writeFileSync(path.join(resources, 'host.json'), JSON.stringify({ schema: 1, ...host, codeHash: layout.codeHash,
            libraryHash: hash(fs.readFileSync(libraryPath(staged))) }) + '\n');
        const signingPermissions = signGemini(stagedApp, staging);
        verifySignature(stagedApp);
        if (inspectNativeLoader(fs.readFileSync(staged.executable)).codeHash !== layout.codeHash) throw Error('Original Gemini executable data changed.');
        if (executableHash(bundle) !== installedHeaderHash) throw Error('Gemini changed during preparation; no changes were installed.');
        return { bundle, staging, stagedApp, report: { state: 'prepared', app: bundle.app, version: bundle.version,
            installedHeaderHash, headerHash: executableHash(staged), refreshing, originalLogicPreserved: true,
            originalDataHash: layout.codeHash, preservedDataHash: layout.codeHash, signingPermissions } };
    } catch (error) { fs.rmSync(staging, { recursive: true, force: true }); throw error; }
}

export function commitGemini(stage, { verifyInstalled = verifyInstalledGemini } = {}) {
    const { bundle, stagedApp, report } = stage, paths = nativePaths(), previous = readNativeState(bundle, paths);
    assertCodexClosed(bundle);
    if (executableHash(bundle) !== report.installedHeaderHash) throw Error('Gemini changed after preparation; no changes were installed.');
    if (report.refreshing && previous?.headerHash !== report.installedHeaderHash) throw Error('The Gemini backup changed after preparation.');
    verifySignature(bundle.app); verifySignature(stagedApp);
    fs.mkdirSync(paths.support, { recursive: true });
    const backup = report.refreshing ? previous.backup : path.join(paths.support, `codex-original-${randomUUID()}`);
    if (report.refreshing) verifySignature(backup);
    const displaced = report.refreshing ? path.join(stage.staging, 'previous-app') : backup;
    const stateFile = path.join(paths.support, `.gemini-native-${randomUUID()}.json`);
    const previousState = fs.existsSync(paths.state) ? fs.readFileSync(paths.state) : null;
    let moved = false, stateChanged = false;
    try {
        fs.writeFileSync(stateFile, JSON.stringify({ version: 1, adapter: 'gemini', app: bundle.app, backup, headerHash: report.headerHash,
            installedAt: new Date().toISOString(), originalLogicPreserved: true }) + '\n', { flag: 'wx', mode: 0o600 });
        assertCodexClosed(bundle);
        fs.renameSync(bundle.app, displaced); moved = true;
        fs.renameSync(stagedApp, bundle.app);
        fs.renameSync(stateFile, paths.state); stateChanged = true;
        verifyInstalled(bundle); moved = false;
        if (previous && !report.refreshing) { try { fs.rmSync(previous.backup, { recursive: true, force: true }); } catch { /* Keep a valid obsolete backup if cleanup is denied. */ } }
        return report;
    } catch (error) {
        if (moved) { fs.rmSync(bundle.app, { recursive: true, force: true }); fs.renameSync(displaced, bundle.app); }
        if (stateChanged) { if (previousState) fs.writeFileSync(paths.state, previousState); else fs.rmSync(paths.state, { force: true }); }
        throw error;
    } finally { fs.rmSync(stateFile, { force: true }); }
}

export function restoreGemini(bundle) {
    const paths = nativePaths(), state = readNativeState(bundle, paths);
    if (!state) return false;
    if (state.adapter !== 'gemini' || executableHash(bundle) !== state.headerHash) throw Error('Gemini changed since installation. Refusing to replace an updated app with an older backup.');
    assertCodexClosed(bundle); verifySignature(state.backup);
    const removed = path.join(path.dirname(bundle.app), `.rasta-restore-${randomUUID()}`);
    fs.renameSync(bundle.app, removed);
    try { fs.renameSync(state.backup, bundle.app); }
    catch (error) { fs.renameSync(removed, bundle.app); throw error; }
    fs.rmSync(paths.state, { force: true }); fs.rmSync(removed, { recursive: true, force: true });
    return true;
}
