import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { targetDefinition } from '../bin/lib/targets.js';
import { verifyReleaseEnvelope } from '../bin/lib/update-feed.js';
import { connectionEngineId, libraryPackageDirectory, libraryPackagePath, omitConnectionEngine, restoreConnectionEngine } from '../bin/lib/connection-engine.js';

export const PUBLIC_REPOSITORY = 'amirmahdinezhad/rasta';
export const catalogTargets = [
    { id: 'codex', prefix: 'Rasta' },
    { id: 't3', prefix: 'Rasta-T3' },
    { id: 'antigravity', prefix: 'Rasta-Antigravity', versions: ['2.29.1'] },
    { id: 'claude', prefix: 'Rasta-Claude', versions: ['4.4212.0'] },
    { id: 'opencode', prefix: 'Rasta-OpenCode' },
    { id: 'zcode', prefix: 'Rasta-ZCode' },
    { id: 'grokbot', prefix: 'Rasta-Grok-Bot' },
    { id: 'gemini', prefix: 'Rasta-Gemini' },
].map(entry => ({ ...entry, app: targetDefinition(entry.id).setup, stableFeed: targetDefinition(entry.id).feed }));
export const targets = catalogTargets;

/** Invoke fixed tool arguments without a shell; never include credentials in arguments. */
export function run(command, args, options = {}) {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
export const gh = args => run('gh', args);
export const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
/** Acceptance must name the immutable source and bytes tested in every app. */
export function validateAcceptance(acceptance, candidate) {
    if (acceptance?.githubPublicationAuthorized !== true || acceptance.version !== candidate.version || acceptance.sourceCommit !== candidate.sourceCommit)
        throw new Error('Explicit acceptance and GitHub authorization for this exact candidate are required.');
    if (candidate.manager && (acceptance.manager?.sha256 !== candidate.manager.sha256 || acceptance.manager?.dmgSha256 !== candidate.manager.dmgSha256
        || !['discovery', 'selectiveDownload', 'offlineRepair', 'targetOnlyUpdate', 'removal', 'appWorking'].every(key => acceptance.manager[key] === true)))
        throw Error('Manual unified Rasta acceptance is incomplete.');
    const observations = candidate.manager
        ? ['libraryOffersVersion', 'libraryDownloadComplete', 'libraryInstallComplete', 'versionDisplayed', 'appWorking']
        : ['closedPanelDot', 'refreshOffersVersion', 'panelUpgradeComplete', 'versionDisplayed', 'appWorking'];
    for (const target of targets) {
        const observation = acceptance.targets?.[target.id], artifact = candidate.artifacts.find(item => item.target === target.id);
        if (!artifact || observation?.sha256 !== (artifact.library?.sha256 || artifact.sha256) || !observations.every(key => observation[key] === true))
            throw new Error(`Manual acceptance is incomplete for ${target.id}.`);
    }
}
/** Verify the distributable ZIP bytes and extracted signature, independently after download. */
export function verifyZip(file, artifact, folder, engineRuntime) {
    if (path.basename(artifact.filename) !== artifact.filename || !/^[a-f0-9]{64}$/.test(artifact.sha256) || digest(file) !== artifact.sha256 || fs.statSync(file).size !== artifact.size)
        throw new Error('Downloaded installer does not match the tested artifact.');
    fs.mkdirSync(folder, { recursive: true });
    run('/usr/bin/ditto', ['-x', '-k', file, folder]);
    const app = path.join(folder, catalogTargets.find(t => t.id === artifact.target).app);
    const runtime = path.join(app, 'Contents/Resources/runtime');
    if (artifact.engine) {
        if (connectionEngineId(engineRuntime) !== artifact.engine) throw Error('The shared engine does not match the verified compact package.');
        restoreConnectionEngine(runtime, engineRuntime);
    }
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    return app;
}

/** Archive the signed bundle's connection files. Library restores its sealed resources before execution. */
export function buildLibraryZip(app, file) {
    const engine = connectionEngineId(path.join(app, 'Contents/Resources/runtime'));
    const stage = fs.mkdtempSync(path.join(path.dirname(file), '.library-'));
    try {
        const compact = path.join(stage, path.basename(app));
        run('/usr/bin/ditto', [app, compact]);
        omitConnectionEngine(path.join(compact, 'Contents/Resources/runtime'));
        run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', compact, file]);
        return { filename: path.basename(file), sha256: digest(file), size: fs.statSync(file).size, engine };
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

export function verifyBundledLibraryPackages(runtime, artifacts) {
    const directory = libraryPackageDirectory(runtime);
    const entries = fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
    const expected = artifacts.map(item => `${item.target}.zip`).sort();
    if (entries.length !== expected.length || entries.some((entry, index) => entry !== expected[index]))
        throw Error('The manager contains an unexpected set of bundled connection packages.');
    if (!artifacts.length) return;
    const engine = connectionEngineId(runtime);
    for (const { target, library } of artifacts) {
        const file = libraryPackagePath(runtime, target), info = fs.lstatSync(file);
        if (!info.isFile() || info.size !== library.size || digest(file) !== library.sha256 || library.engine !== engine)
            throw Error(`The bundled ${target} package does not match the verified Library artifact or shared engine.`);
    }
}

export function bundleLibraryPackages(runtime, directory, artifacts) {
    if (artifacts.length) fs.mkdirSync(libraryPackageDirectory(runtime), { recursive: true });
    for (const { target, library } of artifacts) {
        if (!catalogTargets.some(item => item.id === target) || path.basename(library.filename) !== library.filename)
            throw Error('Invalid bundled Library package.');
        fs.copyFileSync(path.join(directory, library.filename), libraryPackagePath(runtime, target), fs.constants.COPYFILE_EXCL);
    }
    verifyBundledLibraryPackages(runtime, artifacts);
}

export const buildPlatforms = Object.freeze({
    'darwin-arm64': 'arm64',
    'darwin-x64': 'x86_64',
});

export const releasePlatforms = Object.freeze({ 'darwin-arm64': buildPlatforms['darwin-arm64'] });

export const platformTargets = platform => catalogTargets.filter(target => target.id !== 'gemini' || platform === 'darwin-arm64');

export function verifyArchitecture(file, platform) {
    const arch = run('/usr/bin/lipo', ['-archs', file]).trim();
    if (!buildPlatforms[platform] || arch !== buildPlatforms[platform]) throw Error(`Expected a single ${platform} slice in ${file}, got ${arch}.`);
}

export function verifyManager(directory, manager, artifacts, folder, platform) {
    const zip = checkedAsset(directory, manager);
    const dmg = checkedAsset(directory, { filename: manager.dmg, sha256: manager.dmgSha256, size: manager.dmgSize });
    run('/usr/bin/ditto', ['-x', '-k', zip, folder]);
    const app = path.join(folder, 'Rasta.app');
    const runtime = path.join(app, 'Contents/Resources/runtime');
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    verifyArchitecture(path.join(app, 'Contents/MacOS/Rasta'), platform);
    verifyArchitecture(path.join(runtime, 'node'), platform);
    verifyBundledLibraryPackages(runtime, artifacts);
    run('/usr/bin/hdiutil', ['verify', dmg]);
    const mount = fs.mkdtempSync(path.join(folder, '.mount-'));
    try {
        run('/usr/bin/hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount]);
        try {
            const mounted = path.join(mount, 'Rasta.app');
            run('/usr/bin/codesign', ['--verify', '--deep', '--strict', mounted]);
            for (const file of ['Contents/MacOS/Rasta', 'Contents/Info.plist', 'Contents/_CodeSignature/CodeResources']) {
                if (digest(path.join(app, file)) !== digest(path.join(mounted, file))) throw Error('The DMG and updater ZIP contain different app builds.');
            }
        } finally { run('/usr/bin/hdiutil', ['detach', mount]); }
    } finally { fs.rmdirSync(mount); }
    return runtime;
}

export function checkedAsset(directory, artifact) {
    if (!artifact || typeof artifact.filename !== 'string' || !/^[a-zA-Z0-9][\w.-]*$/.test(artifact.filename)
        || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size <= 0)
        throw Error('Invalid release artifact record.');
    const file = path.join(directory, artifact.filename);
    if (fs.statSync(file).size !== artifact.size || digest(file) !== artifact.sha256) throw Error(`Release artifact checksum or size mismatch for ${artifact.filename}.`);
    return file;
}

export function verifyConnection(directory, artifact, folder, platform, engine) {
    const app = verifyZip(checkedAsset(directory, artifact), artifact, path.join(folder, 'full'));
    const runtime = path.join(app, 'Contents/Resources/runtime');
    verifyArchitecture(path.join(app, 'Contents/MacOS/Rasta Setup'), platform);
    verifyArchitecture(path.join(runtime, 'node'), platform);
    verifyArchitecture(path.join(runtime, 'rasta-ui'), platform);
    if (artifact.target === 'gemini') verifyArchitecture(path.join(runtime, 'bin/assets/rasta-gemini.dylib'), platform);
    const compact = { ...artifact, ...artifact.library };
    verifyZip(checkedAsset(directory, compact), compact, path.join(folder, 'library'), engine || runtime);
}

export function releaseBuilds(candidate) {
    if (Object.keys(candidate.builds || {}).some(platform => !Object.hasOwn(releasePlatforms, platform)) || !candidate.builds?.['darwin-arm64'])
        throw Error('An Apple Silicon build is required for this release.');
    return Object.keys(releasePlatforms).map(platform => {
        const build = candidate.builds[platform];
        const ids = targets.map(target => target.id).sort().join(',');
        if (!build?.manager || !Array.isArray(build.artifacts) || build.artifacts.map(item => item.target).sort().join(',') !== ids)
            throw Error(`Missing or unexpected release files for ${platform}.`);
        return [platform, build];
    });
}

export function validateReleaseAcceptance(acceptance, candidate) {
    for (const [platform, build] of releaseBuilds(candidate)) {
        validateAcceptance({ ...acceptance.platforms?.[platform], version: acceptance.version,
            sourceCommit: acceptance.sourceCommit, githubPublicationAuthorized: acceptance.githubPublicationAuthorized },
        { ...candidate, ...build });
    }
}

/** Check published and embedded metadata against the exact verified artifacts. */
export function verifySignedRelease({ directory, candidate, platform, build, publicKey, bundledFeeds }) {
    const verify = (envelope, item, target) => {
        const manifest = verifyReleaseEnvelope(envelope, publicKey, platform, target);
        const matches = (download, asset) => download?.sha256 === asset.sha256 && download.size === asset.size
            && download.url === `https://github.com/${PUBLIC_REPOSITORY}/releases/download/${candidate.tag}/${encodeURIComponent(asset.filename)}`;
        if (manifest.agentVersion !== candidate.version || !matches(manifest.artifact, item)
            || (item.library && (!matches(manifest.libraryArtifact, item.library) || manifest.libraryArtifact.engine !== item.library.engine)))
            throw Error(`The signed ${target} feed does not match the ${platform} artifacts.`);
    };
    const readFeed = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
    verify(readFeed('rasta-manager-release.json'), build.manager, 'codex');
    for (const target of targets) {
        const item = build.artifacts.find(artifact => artifact.target === target.id);
        verify(readFeed(target.stableFeed), item, target.id);
        verify(bundledFeeds?.[target.id], item, target.id);
    }
}
