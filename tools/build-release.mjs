import fs from 'node:fs';
import path from 'node:path';
import { createPublicKey, createPrivateKey } from 'node:crypto';
import { signedManifest } from './release-manifest.mjs';
import { targetReleaseConfiguration } from '../bin/lib/targets.js';
import {
    PUBLIC_REPOSITORY, targets, run, digest, save, buildLibraryZip, releasePlatforms,
    releaseBuilds, verifyArchitecture, verifyConnection, verifyManager, verifySignedRelease,
} from './development-release.js';

const [version] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '') || process.platform !== 'darwin')
    throw Error('On macOS, provide the owner-approved candidate version.');
const tag = `v${version}`;
const outputDirectory = path.resolve('dist/release', version);
let directory = outputDirectory;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sourceCommit = run('git', ['rev-parse', 'HEAD']).trim();
if (run('git', ['status', '--porcelain']).trim()) throw Error('Use a clean checkout of the exact candidate commit.');
if (read('package.json').version !== version || read('package-lock.json').packages[''].version !== version)
    throw Error('The requested version must match the checked-in release version.');
const notes = path.resolve('docs/releases', `${version}.md`);
if (!fs.statSync(notes, { throwIfNoEntry: false })?.isFile()) throw Error('Provide the reviewed release notes for this version.');
const review = path.resolve('docs/releases', `${version}.security.md`);
if (!fs.statSync(review, { throwIfNoEntry: false })?.isFile()) throw Error('Provide the source security review for this version.');
if (read('bin/manager-config.json').version !== version) throw Error('The manager default version must match the release.');
const config = read('bin/release-config.json');
if (config.publicKey !== read('bin/manager-config.json').publicKey) throw Error('The app and manager trust keys differ.');
const securityReport = 'security-checks.json';

const output = file => ({ filename: path.basename(file), size: fs.statSync(file).size, sha256: digest(file) });
const archive = (app, file) => run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, file]);
const fromAsset = item => ({ artifact: path.join(directory, item.filename),
    ...(item.library ? { library: { file: path.join(directory, item.library.filename), engine: item.library.engine } } : {}) });

function signPackages(packages, target) {
    const { supportedAppVersions, blockedAppVersions } = targetReleaseConfiguration(config, target.id);
    return signedManifest({ packages, repository: PUBLIC_REPOSITORY, version, privateKey, target: target.id,
        supportedAppVersions: target.manager ? [] : supportedAppVersions, blockedAppVersions,
        releaseNotes: target.manager ? ['Manage compatible connections and verified updates in Rasta Library.']
            : read(`docs/release-notes-${target.id}.json`) }).envelope;
}

if (process.arch !== 'arm64') throw Error('Start the release build with native Node on Apple Silicon.');
if (fs.existsSync(directory)) throw Error('Inspect the existing candidate directory before rebuilding.');
const keyFile = process.env.ARTL_RELEASE_PRIVATE_KEY_FILE;
if (!keyFile) throw Error('Provide ARTL_RELEASE_PRIVATE_KEY_FILE.');
const privateKey = fs.readFileSync(keyFile);
delete process.env.ARTL_RELEASE_PRIVATE_KEY_FILE;
delete process.env.ARTL_RELEASE_PUBLIC_KEY;
delete process.env.ARTL_RELEASE_FEED;
delete process.env.ARTL_LOCAL_CANDIDATE;
const publicKey = createPublicKey(createPrivateKey(privateKey)).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
if (publicKey !== config.publicKey) throw Error('Release key does not match the pinned key.');

const notaryProfile = process.env.ARTL_NOTARY_PROFILE;
const signingIdentity = process.env.ARTL_CODESIGN_IDENTITY || '-';
if ((signingIdentity !== '-') !== Boolean(notaryProfile)) throw Error('Provide a Developer ID identity and an Apple notary Keychain profile together.');
function notarize(file) {
    run('/usr/bin/xcrun', ['notarytool', 'submit', file, '--keychain-profile', notaryProfile, '--wait'], { stdio: 'inherit' });
}
function notarizeApp(app, work) {
    if (!notaryProfile) return;
    const zip = path.join(work, 'notarization.zip');
    archive(app, zip);
    notarize(zip);
    run('/usr/bin/xcrun', ['stapler', 'staple', app]);
    run('/usr/bin/xcrun', ['stapler', 'validate', app]);
    fs.unlinkSync(zip);
}

fs.mkdirSync(path.dirname(outputDirectory), { recursive: true });
directory = fs.mkdtempSync(path.join(path.dirname(outputDirectory), `.${version}-`));
try {
    run('npm', ['ci'], { stdio: 'inherit' });
    run('npm', ['--prefix', 'ui/manager', 'ci'], { stdio: 'inherit' });
    run('npm', ['run', 'release:check', '--', path.join(directory, securityReport)], { stdio: 'inherit' });

    const nodeVersion = '24.22.3';
    const runtimeURL = `https://nodejs.org/dist/v${nodeVersion}`;
    const scratch = path.join(directory, 'build');
    fs.mkdirSync(scratch);
    const download = (name, file) => run('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--proto', '=https', `${runtimeURL}/${name}`, '--output', file]);
    const checksums = path.join(scratch, 'SHASUMS256.txt');
    download('SHASUMS256.txt', checksums);
    const hashes = new Map(fs.readFileSync(checksums, 'utf8').trim().split('\n').map(line => {
        const [hash, name] = line.trim().split(/\s+/, 2);
        return [name, hash];
    }));
    const candidate = { version, tag, sourceCommit, nodeVersion, securityReportSha256: digest(path.join(directory, securityReport)), builds: {} };
    for (const [platform, arch] of Object.entries(releasePlatforms)) {
        const build = { artifacts: [] };
        candidate.builds[platform] = build;
        const work = path.join(scratch, platform);
        fs.mkdirSync(work);
        const runtimeName = `node-v${nodeVersion}-${platform}`;
        const tarName = runtimeName + '.tar.xz', tar = path.join(work, tarName);
        download(tarName, tar);
        if (digest(tar) !== hashes.get(tarName)) throw Error(`Official Node checksum mismatch for ${platform}.`);
        run('/usr/bin/tar', ['-xf', tar, '-C', work]);
        const node = path.join(work, runtimeName, 'bin/node');
        verifyArchitecture(node, platform);
        if (run(node, ['--version']).trim() !== `v${nodeVersion}`) throw Error('The verified Node runtime did not run.');
        const env = { ...process.env, ARTL_RELEASE_BUILD_ID: sourceCommit, ARTL_BUILD_ARCH: arch, ARTL_PORTABLE_NODE: node, ARTL_NODE_LICENSE: path.join(work, runtimeName, 'LICENSE') };
        for (const target of targets) {
            const app = path.join(work, target.app);
            const vars = { ...env, ARTL_TARGET: target.id, ARTL_TEST_TARGET: target.id, ARTL_GUI_OUTPUT: app };
            run(process.execPath, ['tools/build-gui.mjs'], { env: vars, stdio: 'inherit' });
            if (target.id === 'codex' || target.id === 't3')
                run(process.execPath, ['test/gui-job-smoke.mjs'], { env: vars, stdio: 'inherit' });
            notarizeApp(app, work);
            const full = path.join(directory, `${target.prefix}-${version}-${platform}.zip`);
            archive(app, full);
            const library = buildLibraryZip(app, path.join(directory, `${target.prefix}-Library-${version}-${platform}.zip`));
            build.artifacts.push({ target: target.id, ...output(full), library });
        }
        const bundledFeeds = Object.fromEntries(build.artifacts.map(item => {
            const target = targets.find(entry => entry.id === item.target);
            return [item.target, signPackages({ [platform]: fromAsset(item) }, target)];
        }));
        const app = path.join(work, 'manager', 'Rasta.app');
        const vars = { ...env, ARTL_MANAGER_OUTPUT: app, ARTL_MANAGER_VERSION: version,
            ARTL_LIBRARY_PACKAGES: JSON.stringify({ directory, artifacts: build.artifacts }),
            ARTL_BUNDLED_FEEDS: JSON.stringify(bundledFeeds), ARTL_CODEX_STATE_HOME: path.join(work, 'manager-test-home') };
        run(process.execPath, ['tools/build-manager.mjs'], { env: vars, stdio: 'inherit' });
        run(path.join(app, 'Contents/MacOS/Rasta'), ['--self-test'], { env: vars, timeout: 45000 });
        notarizeApp(app, work);
        const zip = path.join(directory, `Rasta-Manager-${version}-${platform}.zip`);
        const dmg = path.join(directory, `Rasta-${version}-${platform}.dmg`);
        archive(app, zip);
        run(process.execPath, ['tools/build-manager-dmg.mjs'], { env: { ...vars, ARTL_MANAGER_DMG: dmg }, stdio: 'inherit' });
        if (notaryProfile) {
            notarize(dmg);
            run('/usr/bin/xcrun', ['stapler', 'staple', dmg]);
            run('/usr/bin/xcrun', ['stapler', 'validate', dmg]);
        }
        build.manager = { ...output(zip), dmg: path.basename(dmg), dmgSha256: digest(dmg), dmgSize: fs.statSync(dmg).size };
    }
    for (const target of targets) {
        const packages = Object.fromEntries(releaseBuilds(candidate).map(([platform, build]) =>
            [platform, fromAsset(build.artifacts.find(item => item.target === target.id))]));
        save(path.join(directory, target.stableFeed), signPackages(packages, target));
    }
    const manager = Object.fromEntries(releaseBuilds(candidate).map(([platform, build]) => [platform, fromAsset(build.manager)]));
    save(path.join(directory, 'rasta-manager-release.json'), signPackages(manager, { id: 'codex', manager: true }));

    for (const [platform, build] of releaseBuilds(candidate)) {
        const folder = path.join(scratch, 'verified', platform);
        const engine = verifyManager(directory, build.manager, build.artifacts, path.join(folder, 'manager'), platform);
        const packaged = read(path.join(engine, 'bin/manager-config.json'));
        verifySignedRelease({ directory, candidate, platform, build, publicKey: config.publicKey, bundledFeeds: packaged.bundledFeeds });
        for (const item of build.artifacts)
            verifyConnection(directory, item, path.join(folder, item.target), platform, engine);
        const alias = 'Rasta-Apple-Silicon.dmg';
        fs.copyFileSync(path.join(directory, build.manager.dmg), path.join(directory, alias), fs.constants.COPYFILE_EXCL);
    }
    run('git', ['diff', '--exit-code', 'HEAD']);
    save(path.join(directory, 'candidate.json'), candidate);
    fs.rmSync(scratch, { recursive: true });
    fs.renameSync(directory, outputDirectory);
    console.log(`Verified the Apple Silicon release in ${outputDirectory}. Review file sizes and checksums in candidate.json.`);
} catch (error) {
    console.error(`Release build stopped. Local evidence was retained in ${directory}.`);
    throw error;
}
