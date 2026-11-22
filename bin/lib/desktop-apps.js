import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { matchesPackageName, targetDefinition } from './targets.js';
import { desktopAdapter, desktopTargets } from './desktop-adapters.js';

/** Library discovery checks identity. Installation also requires a compatible adapter. */
export function resolveDesktopApp(id, explicit = null, { roots = ['/Applications', path.join(os.homedir(), 'Applications')], discoverOnly = false } = {}) {
    if (!desktopTargets.includes(id)) throw Error('Unknown desktop connection.');
    const target = targetDefinition(id);
    for (const candidate of explicit ? [explicit] : roots.map(root => path.join(root, `${target.name}.app`))) {
        if (!fs.existsSync(candidate)) continue;
        const app = fs.realpathSync(candidate);
        try {
            const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
            if (plist.CFBundleIdentifier !== target.bundleId) throw Error(`Unexpected ${target.name} application identity.`);
            const name = plist.CFBundleExecutable;
            if (typeof name !== 'string' || !name || path.basename(name) !== name || ['.', '..'].includes(name)) throw Error(`Invalid ${target.name} executable.`);
            const executable = path.join(app, 'Contents/MacOS', name);
            if (!fs.statSync(executable).isFile()) throw Error(`Missing ${target.name} executable.`);
            const version = plist.CFBundleShortVersionString, build = plist.CFBundleVersion;
            if (typeof version !== 'string' || !version || typeof build !== 'string' || !build) throw Error(`Missing ${target.name} version/build.`);
            const archive = path.join(app, 'Contents/Resources/app.asar'); asar.uncache(archive);
            let pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
            if (!matchesPackageName(target, pkg.name) || pkg.version !== version) throw Error(`${target.name} bundle and archive identity/version do not agree.`);
            const bundle = { app, executable, archive, target: id, version, build, bundleId: plist.CFBundleIdentifier, htmlPaths: [],
                injection: 'isolated-world', allowDisabledIntegrity: id !== 'claude' };
            if (discoverOnly) return bundle;
            if (['rasta/main.cjs', 'rasta/main.mjs'].includes(pkg.main)) pkg = { ...pkg, main: JSON.parse(asar.extractFile(archive, 'rasta/host.json')).originalMain };
            return { ...bundle, desktopAdapter: desktopAdapter(archive, id, pkg) };
        } catch (error) { if (explicit) throw error; }
    }
    return null;
}
