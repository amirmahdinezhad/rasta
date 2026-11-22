import fs from 'node:fs';
import path from 'node:path';
import {
    PUBLIC_REPOSITORY, targets, run, gh, digest, verifyManager, verifyConnection,
    validateReleaseAcceptance, releaseBuilds, verifySignedRelease,
} from './development-release.js';

const [version, acceptanceFile] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !acceptanceFile)
    throw Error('Provide the approved version and its exact native acceptance record.');

const read = file => JSON.parse(fs.readFileSync(file));
const acceptance = read(acceptanceFile);
const sourceCommit = run('git', ['rev-parse', 'HEAD']).trim();
const tag = `v${version}`;
const directory = path.resolve('dist/release', version);
const candidate = read(path.join(directory, 'candidate.json'));
const reportFile = path.join(directory, 'security-checks.json');
const report = read(reportFile);
if (candidate.tag !== tag || candidate.version !== version || candidate.sourceCommit !== sourceCommit
    || report.sourceCommit !== sourceCommit || report.result !== 'passed' || digest(reportFile) !== candidate.securityReportSha256
    || read('package.json').version !== version || run('git', ['status', '--porcelain']).trim())
    throw Error('Use the clean, verified checkout of the exact local release candidate.');
validateReleaseAcceptance(acceptance, candidate);
const upstream = run('git', ['ls-remote', 'origin', 'refs/heads/main']).trim().split(/\s+/)[0];
if (upstream !== sourceCommit) throw Error('Public main must already point to the approved source.');
const { publicKey } = read('bin/release-config.json');
const existing = JSON.parse(gh(['api', `repos/${PUBLIC_REPOSITORY}`]));
if (existing.private || existing.full_name.toLowerCase() !== PUBLIC_REPOSITORY) throw Error('Expected the public Rasta repository.');
run('npm', ['run', 'security:check'], { stdio: 'inherit' });

const scratch = fs.mkdtempSync(path.join(directory, '.publication-'));
const feeds = ['rasta-manager-release.json', ...targets.map(target => target.stableFeed)];
const names = ['candidate.json', 'security-checks.json', ...feeds];
const latest = [...feeds];
try {
    for (const [platform, build] of releaseBuilds(candidate)) {
        const { manager, artifacts } = build;
        const folder = path.join(scratch, platform);
        const engine = verifyManager(directory, manager, artifacts, path.join(folder, 'manager'), platform);
        const { bundledFeeds } = read(path.join(engine, 'bin/manager-config.json'));
        verifySignedRelease({ directory, candidate, platform, build, publicKey, bundledFeeds });
        for (const item of artifacts) {
            verifyConnection(directory, item, path.join(folder, item.target), platform, engine);
            names.push(item.filename, item.library.filename);
        }
        const alias = 'Rasta-Apple-Silicon.dmg';
        if (digest(path.join(directory, alias)) !== manager.dmgSha256) throw Error('The permanent DMG name does not match the tested file.');
        names.push(manager.filename, manager.dmg, alias);
        latest.push(alias);
    }
    const notes = path.resolve('docs/releases', `${version}.md`);
    gh(['release', 'create', tag, ...names.map(name => path.join(directory, name)), '--repo', PUBLIC_REPOSITORY,
        '--target', sourceCommit, '--title', `Rasta ${version}`, '--notes-file', notes, '--draft', '--latest=false']);
    const draft = path.join(scratch, 'draft');
    gh(['release', 'download', tag, '--repo', PUBLIC_REPOSITORY, '--dir', draft]);
    for (const name of names) if (digest(path.join(draft, name)) !== digest(path.join(directory, name))) throw Error(`Draft asset differs: ${name}.`);
    gh(['release', 'edit', tag, '--repo', PUBLIC_REPOSITORY, '--draft=false', '--latest=false']);
    const fetch = (name, route) => {
        const file = path.join(scratch, `anonymous-${name}`);
        const url = `https://github.com/${PUBLIC_REPOSITORY}/releases/${route}/${encodeURIComponent(name)}`;
        run('/usr/bin/curl', ['--disable', '--fail', '--location', '--silent', '--show-error', '--retry', '3', '--retry-all-errors',
            '--proto', '=https', '--output', file, url]);
        if (digest(file) !== digest(path.join(directory, name))) throw Error(`Public asset differs: ${name}.`);
    };
    for (const name of names) fetch(name, `download/${tag}`);
    if (run('git', ['ls-remote', 'origin', `refs/tags/${tag}`]).trim().split(/\s+/)[0] !== sourceCommit)
        throw Error('The published tag does not point to the tested source.');
    gh(['release', 'edit', tag, '--repo', PUBLIC_REPOSITORY, '--latest']);
    for (const name of latest) fetch(name, 'latest/download');
    console.log(`Public ${tag} downloads verified for Apple Silicon. Stable Library acceptance remains separate.`);
} finally {
    fs.rmSync(scratch, { recursive: true, force: true });
}
