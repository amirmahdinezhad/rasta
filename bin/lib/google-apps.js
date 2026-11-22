import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { targetDefinition } from './targets.js';

/** Read Google host identities without launching, modifying or adopting their data. */
export function resolveGoogleApp(id, explicit = null, { roots = ['/Applications', path.join(os.homedir(), 'Applications')], readPlist = file => JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } = {}) {
    if (!['antigravity', 'gemini'].includes(id)) throw Error('Unknown Google connection.');
    const target = targetDefinition(id);
    const candidates = explicit ? [explicit] : roots.map(root => path.join(root, `${target.name}.app`));
    for (const app of candidates) {
        if (!fs.existsSync(app)) continue;
        try {
            const plist = readPlist(path.join(app, 'Contents/Info.plist'));
            if (plist.CFBundleIdentifier !== target.bundleId) throw Error(`Unexpected ${target.name} application identity.`);
            const name = plist.CFBundleExecutable;
            if (typeof name !== 'string' || !name || path.basename(name) !== name || ['.', '..'].includes(name)) throw Error(`Invalid ${target.name} executable.`);
            const executable = path.join(app, 'Contents/MacOS', name);
            if (!fs.statSync(executable).isFile()) throw Error(`Missing ${target.name} executable.`);
            const version = plist.CFBundleShortVersionString, build = plist.CFBundleVersion;
            if (typeof version !== 'string' || !version || typeof build !== 'string' || !build) throw Error(`Missing ${target.name} version/build.`);
            const bundle = { app, executable, version, build, bundleId: plist.CFBundleIdentifier, target: id };
            if (id === 'gemini') return { ...bundle, native: true };
            const archive = path.join(app, 'Contents/Resources/app.asar');
            asar.uncache(archive);
            const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
            if (pkg.name !== target.packageName || pkg.version !== version) throw Error('Antigravity bundle and archive identity/version do not agree.');
            return { ...bundle, archive, htmlPaths: [], injection: 'isolated-world', vendorPreload: 'dist/preload.js', allowDisabledIntegrity: true };
        } catch (error) { if (explicit) throw error; }
    }
    return null;
}
