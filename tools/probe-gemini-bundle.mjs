import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveGoogleApp } from '../bin/lib/google-apps.js';
import { localSigningEntitlements } from '../bin/lib/codex-native.js';
import { addNativeLoader, inspectNativeLoader } from '../bin/lib/macho-loader.js';

// Inspect and stage a disposable copy only. Never launch or replace the installed host.
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = resolveGoogleApp('gemini', process.argv[2] || '/Applications/Gemini.app');
if (!bundle) throw Error('Gemini is not installed.');
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const original = fs.readFileSync(bundle.executable), originalHash = digest(original);
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-gemini-bundle-'));
try {
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--test-requirement',
        '=identifier "com.google.GeminiMacOS" and anchor apple generic and certificate leaf[subject.OU] = "EQHXZ8M8AV"', bundle.app]);
    const layout = inspectNativeLoader(original);
    const staged = path.join(folder, 'Gemini.app');
    run('/usr/bin/ditto', [bundle.app, staged]);
    const executable = path.join(staged, path.relative(bundle.app, bundle.executable));
    const library = path.join(path.dirname(executable), 'Rasta.dylib');
    run('/usr/bin/xcrun', ['clang', '-dynamiclib', '-fobjc-arc', '-O2', '-framework', 'AppKit', '-framework', 'CoreText',
        path.join(root, 'native/GeminiTextProbe.m'), '-o', library]);
    fs.writeFileSync(executable, addNativeLoader(original));
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', library]);
    const xml = run('/usr/bin/codesign', ['-d', '--entitlements', ':-', staged]);
    const permissions = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: xml }));
    const entitlements = path.join(folder, 'entitlements.plist');
    fs.writeFileSync(entitlements, JSON.stringify(localSigningEntitlements(permissions)));
    run('/usr/bin/plutil', ['-convert', 'xml1', entitlements]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--preserve-metadata=identifier,flags,runtime', '--entitlements', entitlements, staged]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
    assert.equal(inspectNativeLoader(fs.readFileSync(executable)).codeHash, layout.codeHash);
    let preservedFiles = 0;
    const compare = relative => {
        for (const entry of fs.readdirSync(path.join(bundle.app, relative), { withFileTypes: true })) {
            const next = path.join(relative, entry.name), source = path.join(bundle.app, next), destination = path.join(staged, next);
            if (next === 'Contents/_CodeSignature' || source === bundle.executable) continue;
            if (entry.isDirectory()) compare(next);
            else if (entry.isSymbolicLink()) assert.equal(fs.readlinkSync(destination), fs.readlinkSync(source));
            else { assert.equal(digest(fs.readFileSync(destination)), digest(fs.readFileSync(source)), next); preservedFiles++; }
        }
    };
    compare('');
    console.log(JSON.stringify({ scope: 'disposable-native-bundle-probe', version: bundle.version, build: bundle.build,
        verifiedVendor: true, stagedSignatureVerified: true, originalCodePreserved: true, preservedFiles,
        availablePadding: layout.firstSection - layout.end, launched: false, installed: false }, null, 2));
} finally {
    fs.rmSync(folder, { recursive: true, force: true });
    assert.equal(digest(fs.readFileSync(bundle.executable)), originalHash, 'The installed executable remains unchanged');
}
