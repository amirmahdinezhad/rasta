import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { targets, validateAcceptance, validateReleaseAcceptance } from '../tools/development-release.js';
import { signedManifest } from '../tools/release-manifest.mjs';
import { verifyReleaseEnvelope } from '../bin/lib/update-feed.js';

test('publication requires all hosts to explicitly accept the exact tested source and bytes', () => {
    const candidate = { version: '1.1.1', sourceCommit: 'a'.repeat(40), artifacts: targets.map(({ id }, index) => ({ target: id, sha256: index.toString(16).repeat(64) })) };
    const observation = sha256 => ({ sha256, closedPanelDot: true, refreshOffersVersion: true, panelUpgradeComplete: true, versionDisplayed: true, appWorking: true });
    const accepted = { version: candidate.version, sourceCommit: candidate.sourceCommit, githubPublicationAuthorized: true,
        targets: Object.fromEntries(candidate.artifacts.map(({ target, sha256 }) => [target, observation(sha256)])) };
    assert.doesNotThrow(() => validateAcceptance(accepted, candidate));
    for (const change of [{ githubPublicationAuthorized: false }, { sourceCommit: 'd'.repeat(40) }, { version: '1.1.2' },
        { targets: { ...accepted.targets, t3: { ...accepted.targets.t3, panelUpgradeComplete: false } } },
        { targets: { ...accepted.targets, codex: { ...accepted.targets.codex, sha256: 'e'.repeat(64) } } }]) {
        assert.throws(() => validateAcceptance({ ...accepted, ...change }, candidate));
    }
});

test('unified manager acceptance names exact ZIP/DMG bytes and every central workflow', () => {
    const candidate = { version: '2.0.0', sourceCommit: 'a'.repeat(40), artifacts: targets.map(({ id }, index) => ({ target: id, sha256: index.toString(16).repeat(64) })), manager: { sha256: 'd'.repeat(64), dmgSha256: 'e'.repeat(64) } };
    const observation = sha256 => ({ sha256, libraryOffersVersion: true, libraryDownloadComplete: true, libraryInstallComplete: true, versionDisplayed: true, appWorking: true });
    const acceptance = { version: candidate.version, sourceCommit: candidate.sourceCommit, githubPublicationAuthorized: true,
        targets: Object.fromEntries(candidate.artifacts.map(({ target, sha256 }) => [target, observation(sha256)])) };
    assert.throws(() => validateAcceptance(acceptance, candidate), /unified/);
    acceptance.manager = { ...candidate.manager, discovery: true, selectiveDownload: true, offlineRepair: true, targetOnlyUpdate: true, removal: true, appWorking: true };
    assert.doesNotThrow(() => validateAcceptance(acceptance, candidate));
    const incomplete = { ...acceptance.targets.t3, libraryInstallComplete: false };
    assert.throws(() => validateAcceptance({ ...acceptance, targets: { ...acceptance.targets, t3: incomplete } }, candidate), /t3/);
    for (const change of [{ dmgSha256: 'f'.repeat(64) }, { selectiveDownload: false }])
        assert.throws(() => validateAcceptance({ ...acceptance, manager: { ...acceptance.manager, ...change } }, candidate), /unified/);
});

test('a dual-architecture feed selects only the matching signed download', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-release-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { privateKey } = generateKeyPairSync('ed25519');
    const packages = Object.fromEntries(['darwin-arm64', 'darwin-x64'].map(platform => {
        const artifact = path.join(directory, platform + '.zip');
        fs.writeFileSync(artifact, platform);
        return [platform, { artifact }];
    }));
    const key = privateKey.export({ format: 'pem', type: 'pkcs8' });
    const { envelope, publicKey } = signedManifest({ packages, repository: 'rasta/fixture', version: '1.2.3', supportedAppVersions: [], privateKey: key });
    const artifacts = Object.keys(packages).map(platform => {
        const { artifact } = verifyReleaseEnvelope(envelope, publicKey, platform);
        assert.equal(path.basename(new URL(artifact.url).pathname), platform + '.zip');
        return artifact.sha256;
    });
    assert.notEqual(...artifacts);
    assert.throws(() => verifyReleaseEnvelope(envelope, publicKey, 'darwin-unknown'), /No valid release/);
});

test('publication requires matching Apple Silicon acceptance and rejects extra builds', () => {
    const manager = { sha256: 'd'.repeat(64), dmgSha256: 'e'.repeat(64) };
    const acceptedManager = { ...manager, discovery: true, selectiveDownload: true, offlineRepair: true, targetOnlyUpdate: true, removal: true, appWorking: true };
    const candidate = { version: '1.2.3', sourceCommit: 'a'.repeat(40), builds: {} };
    const acceptance = { version: candidate.version, sourceCommit: candidate.sourceCommit, githubPublicationAuthorized: true, platforms: {} };
    const artifacts = targets.map(target => ({ target: target.id, sha256: 'a'.repeat(64) }));
    candidate.builds['darwin-arm64'] = { manager, artifacts };
    acceptance.platforms['darwin-arm64'] = {
        manager: acceptedManager,
        targets: Object.fromEntries(artifacts.map(({ target, sha256 }) => [target, { sha256, libraryOffersVersion: true,
            libraryDownloadComplete: true, libraryInstallComplete: true, versionDisplayed: true, appWorking: true }])),
    };
    assert.doesNotThrow(() => validateReleaseAcceptance(acceptance, candidate));
    const codex = acceptance.platforms['darwin-arm64'].targets.codex;
    codex.sha256 = 'b'.repeat(64);
    assert.throws(() => validateReleaseAcceptance(acceptance, candidate), /codex/);
    codex.sha256 = artifacts[0].sha256;
    candidate.builds['darwin-x64'] = candidate.builds['darwin-arm64'];
    assert.throws(() => validateReleaseAcceptance(acceptance, candidate), /Apple Silicon/);
    delete candidate.builds['darwin-arm64'];
    assert.throws(() => validateReleaseAcceptance(acceptance, candidate), /Apple Silicon/);
});
