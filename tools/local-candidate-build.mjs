import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    platformTargets, buildPlatforms, verifyArchitecture, PUBLIC_REPOSITORY, run, save,
    buildLibraryZip, digest, verifyZip, verifyBundledLibraryPackages,
} from './development-release.js';
import { signedManifest } from './release-manifest.mjs';
import { targetReleaseConfiguration } from '../bin/lib/targets.js';
const output = process.env.RASTA_LOCAL_OUTPUT;
const version = process.env.RASTA_LOCAL_VERSION;
const buildLabel = process.env.RASTA_LOCAL_BUILD_LABEL;
const source = process.env.RASTA_LOCAL_SOURCE;
if (!output || !/^\d+\.\d+\.\d+$/.test(version || '')) throw Error('Provide RASTA_LOCAL_OUTPUT and RASTA_LOCAL_VERSION.');
if (buildLabel && !/^\d{8}-\d{6}$/.test(buildLabel)) throw Error('Use a YYYYMMDD-HHMMSS local build label.');
if (fs.existsSync('.git')) throw Error('Run this builder from a disposable copy of the source. It updates build metadata in place.');
if (!source || !fs.existsSync(path.join(source, '.git'))) throw Error('Point RASTA_LOCAL_SOURCE to the checkout that supplied the disposable copy.');
const envForChecks = { ...process.env };
delete envForChecks.ARTL_RELEASE_PRIVATE_KEY_FILE;
run('npm', ['run', 'release:check', '--', '--local'], { cwd: source, env: envForChecks, stdio: 'inherit' });
const entries = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: source }).split('\0');
for (const file of new Set(entries.filter(file => /^(?:bin|native|tools|ui\/manager)\//.test(file) || /^package(?:-lock)?\.json$/.test(file)))) {
    const original = path.join(source, file);
    const copy = path.resolve(file);
    const present = fs.lstatSync(original, { throwIfNoEntry: false })?.isFile();
    if (present !== !!fs.lstatSync(copy, { throwIfNoEntry: false })?.isFile() || (present && digest(original) !== digest(copy)))
        throw Error(`The disposable copy differs from the checked source: ${file}.`);
}
const localTestBuildId = randomUUID();
const work = path.resolve('dist/local-candidate');
const platform = process.env.RASTA_LOCAL_PLATFORM || `darwin-${process.arch}`;
const arch = buildPlatforms[platform];
if (!arch || process.platform !== 'darwin') throw Error('A supported macOS architecture is required.');
fs.mkdirSync(work, { recursive: true });
const key = fs.readFileSync(process.env.ARTL_RELEASE_PRIVATE_KEY_FILE);
delete process.env.ARTL_RELEASE_PRIVATE_KEY_FILE;
const read = file => JSON.parse(fs.readFileSync(file));
const pkg = read('package.json');
save('package.json', { ...pkg, version, localTestBuildId });
const release = read('bin/release-config.json');
const manager = read('bin/manager-config.json');
const artifacts = [];
const feeds = {};
for (const target of platformTargets(platform)) {
    console.log('Building', target.id);
    const app = path.join(work, target.app);
    const env = { ...process.env, ARTL_BUILD_ARCH: arch, ARTL_TARGET: target.id, ARTL_GUI_OUTPUT: app };
    run(process.execPath, ['tools/build-gui.mjs'], { env, stdio: 'inherit' });
    verifyArchitecture(path.join(app, 'Contents/Resources/runtime/node'), platform);
    const filename = target.id + '-full.zip';
    const full = path.join(work, filename);
    run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, full]);
    const compact = path.join(work, target.id + '-library.zip');
    const library = buildLibraryZip(app, compact);
    const config = targetReleaseConfiguration(release, target.id);
    const signed = signedManifest({ artifact: full, library: { file: compact, engine: library.engine }, repository: PUBLIC_REPOSITORY, version, platform, target: target.id,
        supportedAppVersions: target.versions || config.supportedAppVersions, blockedAppVersions: config.blockedAppVersions || [], privateKey: key });
    if (signed.publicKey !== manager.publicKey) throw Error('Signing key does not match Rasta.');
    artifacts.push({ target: target.id, filename, sha256: digest(full), size: fs.statSync(full).size, library });
    feeds[target.id] = signed.envelope;
}
save(path.join(work, 'packages.json'), artifacts);
save('bin/manager-config.json', { ...manager, localTestBuildId, localTestFeeds: feeds });
const app = path.join(work, 'Rasta.app');
const env = { ...process.env, ARTL_BUILD_ARCH: arch, ARTL_MANAGER_OUTPUT: app, ARTL_LIBRARY_PACKAGES: JSON.stringify({ directory: work, artifacts }) };
run(process.execPath, ['tools/build-manager.mjs'], { env, stdio: 'inherit' });
const engine = path.join(app, 'Contents/Resources/runtime');
verifyBundledLibraryPackages(engine, artifacts);
for (const artifact of artifacts) {
    const verified = verifyZip(path.join(work, artifact.library.filename), { ...artifact, ...artifact.library }, path.join(work, 'verified', artifact.target), engine);
    if (read(path.join(verified, 'Contents/Resources/runtime/package.json')).localTestBuildId !== localTestBuildId)
        throw Error('Library package has the wrong local test build ID for ' + artifact.target);
    const isolated = { ...env, ARTL_CODEX_STATE_HOME: path.join(work, 'test-home') };
    const request = action => JSON.parse(run(path.join(engine, 'node'), [path.join(engine, 'bin/manager-service.js')],
        { env: isolated, input: JSON.stringify({ action, target: artifact.target }), stdio: ['pipe', 'pipe', 'pipe'] }));
    const info = request('check');
    if (!info.ok || info.value.version !== version) throw Error('Library offered the wrong package for ' + artifact.target);
    const prepared = request('download');
    if (!prepared.ok || prepared.value.version !== version) throw Error('Library did not verify the package for ' + artifact.target);
    console.log('Library verified', artifact.target, version);
}
run(path.join(app, 'Contents/MacOS/Rasta'), ['--self-test'], { env: { ...env, ARTL_CODEX_STATE_HOME: path.join(work, 'test-home') }, timeout: 45000, stdio: 'inherit' });
const dmg = path.join(output, ['Rasta-Local-Test', version, platform, buildLabel].filter(Boolean).join('-') + '.dmg');
const volume = buildLabel ? { ARTL_MANAGER_DMG_VOLUME: 'Rasta Test ' + buildLabel } : {};
fs.mkdirSync(output, { recursive: true });
const staging = fs.mkdtempSync(path.join(output, '.rasta-image-'));
try {
    const image = path.join(staging, 'Rasta.dmg');
    run(process.execPath, ['tools/build-manager-dmg.mjs'], { env: { ...env, ...volume, ARTL_MANAGER_DMG: image }, stdio: 'inherit' });
    fs.linkSync(image, dmg);
} finally {
    fs.rmSync(staging, { recursive: true, force: true });
}
console.log('SHA-256', digest(dmg));
