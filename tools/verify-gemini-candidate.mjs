import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Exercise the packaged preparation entry point on a disposable signed copy.
// Launch and installation of the actual Gemini bundle remain the user's actions.
const source = process.argv[2];
if (!source || !path.isAbsolute(source)) throw Error('Provide the absolute packaged Gemini runtime path.');
if (JSON.parse(fs.readFileSync(path.join(source, 'bin/release-config.json'))).target !== 'gemini') throw Error('The package belongs to another app.');
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-gemini-candidate-')));
const previousHome = process.env.ARTL_CODEX_STATE_HOME, previousTarget = process.env.ARTL_TARGET;
process.env.ARTL_CODEX_STATE_HOME = home; process.env.ARTL_TARGET = 'gemini';
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let stage, discard, bundle, originalHash;
try {
    const runtime = path.join(home, 'Library/Application Support/Rasta Gemini/ui-runtimes/candidate');
    fs.cpSync(source, runtime, { recursive: true, verbatimSymlinks: true });
    const load = name => import(pathToFileURL(path.join(runtime, 'bin/lib', name)).href);
    const { resolveGoogleApp } = await load('google-apps.js');
    const { prepareGUIStage } = await load('gui-updates.js');
    ({ discardNativeStage: discard } = await load('codex-native.js'));
    bundle = resolveGoogleApp('gemini', '/Applications/Gemini.app'); originalHash = hash(bundle.executable);
    const version = JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'))).version;
    stage = prepareGUIStage({ config: { app: bundle.app, runtime, agentVersion: version } });
    assert.equal(stage.report.originalDataHash, stage.report.preservedDataHash);
    assert.equal(hash(bundle.executable), originalHash);
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', stage.stagedApp], { stdio: 'pipe' });
    const receipt = JSON.parse(fs.readFileSync(path.join(stage.stagedApp, 'Contents/Resources/rasta/host.json')));
    assert.equal(receipt.target, 'gemini'); assert.equal(receipt.runtime, runtime); assert.equal(receipt.agentVersion, version);
    console.log(JSON.stringify({ scope: 'packaged-gemini-preparation', agentVersion: version, hostVersion: bundle.version,
        originalCodePreserved: true, stagedSignatureVerified: true, originalAppUnchanged: true, launched: false, installed: false }, null, 2));
} finally {
    if (stage) discard(stage);
    fs.rmSync(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = previousHome;
    if (previousTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = previousTarget;
    if (originalHash) assert.equal(hash(bundle.executable), originalHash, 'The original Gemini executable remains unchanged');
}
